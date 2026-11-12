import { startCast, type CastOptions, type CastResult } from './casting';
import { EventMap } from './eventmap';
import { meleeIfReady } from './melee';
import { edgeDistance } from './movement';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import { threatFor } from './threat';
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
  cast(spellId: string, targetId: string, causes: readonly string[], options?: CastOptions): CastResult;
  /** Makes another unit cast (`unit->CastSpell(...)` in a script); traced with this boss as the original caster (A-020). */
  castAs(casterId: string, spellId: string, targetId: string, causes: readonly string[], options?: CastOptions): CastResult;
  /** Living units on this boss's threat list, sorted by id. */
  threatList(): Unit[];
  /**
   * SelectTarget(Random, ...) on the threat list from stream `boss:<id>.<mechanic>`. Distances are edge to edge (A-021):
   * minDistanceYd = must be farther than, maxDistanceYd = must be within.
   */
  selectTarget(
    mechanic: string,
    options?: { minDistanceYd?: number; maxDistanceYd?: number; excludeVictim?: boolean },
  ): Unit | null;
  /** Picks targets from the stream `boss:<bossId>.<mechanic>` (§8.7). */
  pick(mechanic: string, candidates: readonly Unit[], n: number): Unit[];
  publishTimer(ability: string, minMs: number, maxMs: number, causes: readonly string[]): string;
  setPhase(phase: string, causes: readonly string[]): string;
  meleeIfReady(): string | null;
  setData(key: string, value: number): void;
  getData(key: string): number | undefined;
  /** Removes a published timer window (after a reschedule or delay) and records it. */
  clearTimer(ability: string, causes: readonly string[]): string | null;
}

export interface BossScript {
  readonly bossId: string;
  readonly mechanics: readonly MechanicStatus[];
  /** Known differences from Rising-Gods that are not modelled (§6.4). */
  readonly knownServerDifferences: readonly string[];
  onEngage(ctx: BossContext): void;
  updateAI(ctx: BossContext, diffMs: number): void;
}


/** The creature's current victim according to the threat manager. */
export function victimOf(sim: Simulation, bossId: string): Unit | null {
  return threatFor(sim)?.victim(bossId) ?? null;
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
    if (!ctx.self.cast) this.afterEvents(ctx);
  }

  /** DoMeleeAttackIfReady by default; override to change what happens after events. */
  protected afterEvents(ctx: BossContext): void {
    ctx.meleeIfReady();
  }

  protected abstract engage(ctx: BossContext): void;
  protected abstract executeEvent(eventId: number, ctx: BossContext): void;
}

export function makeBossContext(sim: Simulation, bossId: string): BossContext {
  const self = sim.unit(bossId);
  const data = new Map<string, number>();
  return {
    sim,
    self,
    victim: () => victimOf(sim, bossId),
    ai: (name, data = {}, causes = []) => sim.emit('ai_event', { ...data, boss: bossId, event: name }, causes),
    cast: (spellId, targetId, causes, options) => startCast(sim, bossId, spellId, targetId, causes, options),
    castAs: (casterId, spellId, targetId, causes, options = {}) =>
      startCast(sim, casterId, spellId, targetId, causes, { ...options, originalCasterId: options.originalCasterId ?? bossId }),
    threatList: () => threatFor(sim)?.listed(bossId) ?? [],
    selectTarget: (mechanic, options = {}) => {
      for (const [name, v] of [['minDistanceYd', options.minDistanceYd], ['maxDistanceYd', options.maxDistanceYd]] as const) {
        if (v !== undefined && (!Number.isFinite(v) || v < 0)) throw new Error(`invalid distance bound ${name}=${v}`);
      }
      const victim = options.excludeVictim ? victimOf(sim, bossId) : null;
      const candidates = (threatFor(sim)?.listed(bossId) ?? []).filter((u) => {
        const d = edgeDistance(self, u, sim.now);
        if (options.minDistanceYd !== undefined && !(d > options.minDistanceYd)) return false;
        if (options.maxDistanceYd !== undefined && d > options.maxDistanceYd) return false;
        if (options.excludeVictim && victim && u.id === victim.id) return false;
        return true;
      });
      return sim.rng.stream(`boss:${bossId}.${mechanic}`).pick(candidates, 1)[0] ?? null;
    },
    pick: (mechanic, candidates, n) => sim.rng.stream(`boss:${bossId}.${mechanic}`).pick(candidates, n),
    publishTimer: (ability, minMs, maxMs, causes) => {
      const w = { boss: bossId, ability, earliestMs: sim.now + minMs, latestMs: sim.now + maxMs };
      sim.timerWindows.set(`${bossId}|${ability}`, w);
      return sim.emit('timer_window', { ...w }, causes);
    },
    clearTimer: (ability, causes) => {
      if (!sim.timerWindows.delete(`${bossId}|${ability}`)) return null;
      return sim.emit('timer_window', { boss: bossId, ability, earliestMs: null, latestMs: null, cleared: true }, causes);
    },
    setData: (key, value) => void data.set(key, value),
    getData: (key) => data.get(key),
    meleeIfReady: () => meleeIfReady(sim, bossId, victimOf(sim, bossId)),
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
