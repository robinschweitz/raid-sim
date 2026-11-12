import { startCast, type CastOptions, type CastResult } from './casting';
import { EventMap } from './eventmap';
import { meleeIfReady } from './melee';
import { withinCombatRange } from './movement';
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

/** Filters of SelectTarget / SelectTargetList (DefaultTargetSelector, UnitAI.h 53–100; A-021). */
export interface TargetFilter {
  /** Keep units with edge distance >= this (inclusive): rejected when within combat range of it. */
  readonly minDistanceYd?: number;
  /** Keep units with edge distance < this (strict): IsWithinCombatRange. */
  readonly maxDistanceYd?: number;
  readonly excludeVictim?: boolean;
  /** Players only (the `playerOnly` argument). */
  readonly playersOnly?: boolean;
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
  /** SelectTarget(Random, ...) on the threat list, uniformly from stream `boss:<id>.<mechanic>` (A-021). */
  selectTarget(mechanic: string, options?: TargetFilter): Unit | null;
  /** How many units on the threat list pass the filter (SelectTargetList's size check); draws no random numbers. */
  countTargets(options?: TargetFilter): number;
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
  /** JustEngagedWith(who): `who` is the pulling unit when the encounter starts with a puller (A-033), else null. */
  onEngage(ctx: BossContext, who: Unit | null): void;
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

  onEngage(ctx: BossContext, who: Unit | null = null): void {
    this.events = new EventMap(ctx.sim.rng.stream(`boss:${this.bossId}.timers`));
    this.engage(ctx, who);
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

  protected abstract engage(ctx: BossContext, who: Unit | null): void;
  protected abstract executeEvent(eventId: number, ctx: BossContext): void;
}

export function makeBossContext(sim: Simulation, bossId: string): BossContext {
  const self = sim.unit(bossId);
  const data = new Map<string, number>();
  const candidates = (options: TargetFilter): Unit[] => {
    for (const [name, v] of [['minDistanceYd', options.minDistanceYd], ['maxDistanceYd', options.maxDistanceYd]] as const) {
      if (v !== undefined && (!Number.isFinite(v) || v < 0)) throw new Error(`invalid distance bound ${name}=${v}`);
    }
    const victim = options.excludeVictim ? victimOf(sim, bossId) : null;
    return (threatFor(sim)?.listed(bossId) ?? []).filter((u) => {
      if (options.minDistanceYd !== undefined && withinCombatRange(self, u, options.minDistanceYd, sim.now)) return false;
      if (options.maxDistanceYd !== undefined && !withinCombatRange(self, u, options.maxDistanceYd, sim.now)) return false;
      if (options.excludeVictim && victim && u.id === victim.id) return false;
      if (options.playersOnly && u.kind !== 'player') return false;
      return true;
    });
  };
  return {
    sim,
    self,
    victim: () => victimOf(sim, bossId),
    ai: (name, data = {}, causes = []) => sim.emit('ai_event', { ...data, boss: bossId, event: name }, causes),
    cast: (spellId, targetId, causes, options) => startCast(sim, bossId, spellId, targetId, causes, options),
    castAs: (casterId, spellId, targetId, causes, options = {}) =>
      startCast(sim, casterId, spellId, targetId, causes, { ...options, originalCasterId: options.originalCasterId ?? bossId }),
    threatList: () => threatFor(sim)?.listed(bossId) ?? [],
    selectTarget: (mechanic, options = {}) => sim.rng.stream(`boss:${bossId}.${mechanic}`).pick(candidates(options), 1)[0] ?? null,
    countTargets: (options = {}) => candidates(options).length,
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

/**
 * Emits engage, calls onEngage, and runs updateAI every intervalMs (A-002). With `whoId` (A-033) the engage event names
 * the pulling unit and every living player joins the threat list with 0 threat before the script's engage code
 * (BossAI::_JustEngagedWith → DoZoneInCombat, CreatureAI.cpp 117–162). Returns the engage event id.
 */
export function attachBoss(sim: Simulation, script: BossScript, bossUnitId: string, intervalMs: number, whoId?: string): string {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) throw new Error('AI update interval must be a positive integer');
  let ids = attached.get(sim);
  if (!ids) attached.set(sim, (ids = new Set()));
  if (ids.has(bossUnitId)) throw new Error(`boss ${bossUnitId} is already attached`);
  const who = whoId === undefined ? null : sim.unit(whoId);
  const ctx = makeBossContext(sim, bossUnitId);
  ids.add(bossUnitId);
  const engage = sim.emit('engage', who ? { boss: bossUnitId, who: who.id } : { boss: bossUnitId });
  if (who) {
    for (const p of sim.players()) if (p.alive) threatFor(sim)?.add(bossUnitId, p.id, 0, [engage]);
  }
  script.onEngage(ctx, who);
  const tick = (): void => {
    if (!ctx.self.alive || sim.outcome) return;
    script.updateAI(ctx, intervalMs);
    sim.at(sim.now + intervalMs, EventClass.AiUpdate, tick);
  };
  sim.at(sim.now + intervalMs, EventClass.AiUpdate, tick);
  return engage;
}
