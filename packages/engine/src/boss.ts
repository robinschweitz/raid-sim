import { startCast, type CastResult } from './casting';
import { EventMap } from './eventmap';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import type { TraceValue } from './trace';
import type { Unit } from './units';

export type MechanicStatusKind = 'implemented' | 'partial' | 'not_implemented';
export type ValidationStatus = 'unvalidated' | 'azerothcore_source' | 'rising_gods_logs';

/** Spec §6.1: mechanics status and validation status are reported separately. */
export interface MechanicStatus {
  readonly key: string;
  readonly status: MechanicStatusKind;
  readonly omissions: readonly string[];
  readonly validation: ValidationStatus;
  readonly logRef?: string;
}

export interface BossContext {
  readonly sim: Simulation;
  readonly self: Unit;
  victim(): Unit | null;
  ai(name: string, data?: Readonly<Record<string, TraceValue>>, causes?: readonly string[]): string;
  cast(spellId: string, targetId: string, causes: readonly string[]): CastResult;
  /** Picks targets from the stream `boss:<bossId>.<mechanic>` (§8.7). */
  pick(mechanic: string, candidates: readonly Unit[], n: number): Unit[];
  publishTimer(ability: string, minMs: number, maxMs: number, causes: readonly string[]): string;
  setPhase(phase: string, causes: readonly string[]): string;
}

export interface BossScript {
  readonly bossId: string;
  readonly mechanics: readonly MechanicStatus[];
  /** Known differences from Rising-Gods that are not modelled (§6.4). */
  readonly knownServerDifferences: readonly string[];
  onEngage(ctx: BossContext): void;
  updateAI(ctx: BossContext, diffMs: number): void;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Highest threat among living units on the boss's threat table; ties go to the lowest id. */
export function victimOf(sim: Simulation, bossId: string): Unit | null {
  const boss = sim.unit(bossId);
  let best: Unit | null = null;
  let bestThreat = Number.NEGATIVE_INFINITY;
  for (const id of [...boss.threat.keys()].sort(byString)) {
    const u = sim.units.get(id);
    const threat = boss.threat.get(id)!;
    if (!u || !u.alive) continue;
    if (threat > bestThreat) {
      best = u;
      bestThreat = threat;
    }
  }
  return best;
}

/** Base for scripts written like AzerothCore's EventMap-driven boss AIs. */
export abstract class EventScriptedAI implements BossScript {
  abstract readonly bossId: string;
  abstract readonly mechanics: readonly MechanicStatus[];
  readonly knownServerDifferences: readonly string[] = [];
  protected events!: EventMap;

  onEngage(ctx: BossContext): void {
    this.events = new EventMap(ctx.sim.rng.stream(`boss:${this.bossId}.timers`));
    this.engage(ctx);
  }

  updateAI(ctx: BossContext, diffMs: number): void {
    if (!ctx.victim()) return;
    this.events.update(diffMs);
    if (ctx.self.cast) return;
    const id = this.events.execute();
    if (id !== 0) this.executeEvent(id, ctx);
  }

  protected abstract engage(ctx: BossContext): void;
  protected abstract executeEvent(eventId: number, ctx: BossContext): void;
}

export function makeBossContext(sim: Simulation, bossId: string): BossContext {
  const self = sim.unit(bossId);
  return {
    sim,
    self,
    victim: () => victimOf(sim, bossId),
    ai: (name, data = {}, causes = []) => sim.emit('ai_event', { ...data, boss: bossId, event: name }, causes),
    cast: (spellId, targetId, causes) => startCast(sim, bossId, spellId, targetId, causes),
    pick: (mechanic, candidates, n) => sim.rng.stream(`boss:${bossId}.${mechanic}`).pick(candidates, n),
    publishTimer: (ability, minMs, maxMs, causes) => {
      const w = { boss: bossId, ability, earliestMs: sim.now + minMs, latestMs: sim.now + maxMs };
      sim.timerWindows.set(`${bossId}|${ability}`, w);
      return sim.emit('timer_window', { ...w }, causes);
    },
    setPhase: (phase, causes) => {
      sim.phase = phase;
      return sim.emit('phase_change', { boss: bossId, phase }, causes);
    },
  };
}

const attached = new WeakMap<Simulation, Set<string>>();

/** Emits engage, calls onEngage, and runs updateAI every intervalMs (A-002). Returns the engage event id. */
export function attachBoss(sim: Simulation, script: BossScript, bossUnitId: string, intervalMs: number): string {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) throw new Error('AI update interval must be a positive integer');
  let ids = attached.get(sim);
  if (!ids) attached.set(sim, (ids = new Set()));
  if (ids.has(bossUnitId)) throw new Error(`boss ${bossUnitId} is already attached`);
  const ctx = makeBossContext(sim, bossUnitId);
  ids.add(bossUnitId);
  const engage = sim.emit('engage', { boss: bossUnitId });
  script.onEngage(ctx);
  const tick = (): void => {
    if (!ctx.self.alive || sim.outcome) return;
    script.updateAI(ctx, intervalMs);
    sim.at(sim.now + intervalMs, EventClass.AiUpdate, tick);
  };
  sim.at(sim.now + intervalMs, EventClass.AiUpdate, tick);
  return engage;
}
