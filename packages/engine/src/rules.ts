import { interruptCast } from './casting';
import { edgeDistance } from './movement';
import type { Action, Member, Plan, Rule } from './plan/schema';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import { threatFor } from './threat';
import type { TraceEvent, TraceValue } from './trace';
import { byId, compareStrings, type Unit, type Vec2 } from './units';

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface ActionContext {
  readonly sim: Simulation;
  readonly actor: Unit;
  readonly rule: Rule;
  readonly action: Action;
  readonly causes: readonly string[];
  resolve(ref: string): Unit | null;
  spot(id: string): Vec2;
  assignment(): string | null;
  markMoving(): void;
}

export type ActionHandler = (ctx: ActionContext) => ActionResult;

export interface RuleHooks {
  currentTank(): Unit | null;
}

const MOVE_ACTIONS = new Set(['move_to', 'return_to_assignment']);

const moveTo: ActionHandler = (ctx) => {
  if (ctx.action.do !== 'move_to') return { ok: false, reason: 'wrong_action' };
  if (ctx.actor.speedYdPerSec <= 0) return { ok: false, reason: 'cannot_move' };
  ctx.sim.startMove(ctx.actor.id, ctx.spot(ctx.action.spot), ctx.causes);
  ctx.markMoving();
  return { ok: true };
};

const returnToAssignment: ActionHandler = (ctx) => {
  const spot = ctx.assignment();
  if (spot === null) return { ok: false, reason: 'no_assignment' };
  if (ctx.actor.speedYdPerSec <= 0) return { ok: false, reason: 'cannot_move' };
  ctx.sim.startMove(ctx.actor.id, ctx.spot(spot), ctx.causes);
  ctx.markMoving();
  return { ok: true };
};

const stopCasting: ActionHandler = (ctx) => {
  if (!ctx.actor.cast) return { ok: false, reason: 'not_casting' };
  interruptCast(ctx.sim, ctx.actor.id, 'stopped', ctx.causes);
  return { ok: true };
};

/** Actions every run supports. `taunt` (Plan 2) and `use_cooldown` (Plan 3) are registered by content. */
export const BUILTIN_ACTIONS: ReadonlyMap<string, ActionHandler> = new Map([
  ['move_to', moveTo],
  ['return_to_assignment', returnToAssignment],
  ['stop_casting', stopCasting],
]);

export interface TauntParams {
  readonly rangeYd: number;
  readonly cooldownMs: number;
  readonly durationMs: number;
}

/** Plan action `taunt` for any actor; cooldown state lives in the returned handler (one per run). */
export function createTauntAction(p: TauntParams): ActionHandler {
  const readyAt = new Map<string, number>();
  return (ctx) => {
    if (ctx.action.do !== 'taunt') return { ok: false, reason: 'wrong_action' };
    const target = ctx.resolve(ctx.action.target);
    if (!target || !target.alive) return { ok: false, reason: 'target_dead' };
    const threat = threatFor(ctx.sim);
    if (!threat) return { ok: false, reason: 'no_threat' };
    if ((readyAt.get(ctx.actor.id) ?? 0) > ctx.sim.now) return { ok: false, reason: 'cooldown' };
    if (edgeDistance(ctx.actor, target, ctx.sim.now) > p.rangeYd) return { ok: false, reason: 'out_of_range' };
    const r = threat.taunt(target.id, ctx.actor.id, p.durationMs, ctx.causes);
    if (r !== 'ok') return { ok: false, reason: r };
    readyAt.set(ctx.actor.id, ctx.sim.now + p.cooldownMs);
    return { ok: true };
  };
}

/** Actions the engine provides in every run (BUILTIN_ACTIONS plus taunt, which needs run data). */
export const ENGINE_ACTION_NAMES: ReadonlySet<string> = new Set([...BUILTIN_ACTIONS.keys(), 'taunt']);

export class RuleEngine {
  /** actorId → priority of the running rule move. */
  private readonly moving = new Map<string, number>();
  private readonly active = new Map<string, boolean>();
  private readonly lastFired = new Map<string, number>();
  private readonly members: Map<string, Member>;
  private readonly ordered: Rule[];
  private readonly sortedRoster: Member[];
  private readonly whoSorted = new Map<string, readonly string[]>();

  constructor(
    private readonly sim: Simulation,
    private readonly plan: Plan,
    private readonly handlers: ReadonlyMap<string, ActionHandler>,
    private readonly hooks: RuleHooks,
  ) {
    this.sortedRoster = [...plan.roster].sort(byId);
    this.members = new Map(plan.roster.map((m) => [m.id, m]));
    this.ordered = [...plan.rules].sort(
      (a, b) => b.priority - a.priority || compareStrings(a.id, b.id),
    );
  }

  /** Each rule's actors sorted by id, so list order in the plan never changes the result (§8.7). */
  private whoOf(rule: Rule): readonly string[] {
    let sorted = this.whoSorted.get(rule.id);
    if (!sorted) {
      sorted = [...rule.who].sort(compareStrings);
      this.whoSorted.set(rule.id, sorted);
    }
    return sorted;
  }

  isMoving(actorId: string): boolean {
    return this.moving.has(actorId);
  }

  /** The actor's spot in the current phase, falling back to the default phase. */
  assignment(actorId: string): string | null {
    const current = this.plan.phases.find((p) => p.phase === this.sim.phase);
    const fallback = this.plan.phases.find((p) => p.phase === 'default');
    return current?.assignments[actorId] ?? fallback?.assignments[actorId] ?? null;
  }

  install(): void {
    this.sim.subscribe((ev) => this.onEvent(ev));
    for (const rule of this.ordered) {
      const w = rule.when;
      if (w.on !== 'time') continue;
      this.sim.at(Math.max(w.atMs, this.sim.now), EventClass.Decision, () => {
        for (const actorId of this.whoOf(rule)) this.fire(rule, actorId, []);
      });
    }
  }

  private onEvent(ev: TraceEvent): void {
    if ((ev.kind === 'move_end' || ev.kind === 'death') && typeof ev.data.unit === 'string') this.moving.delete(ev.data.unit);
    if (ev.kind === 'phase_change') this.onPhaseChange(ev);
    for (const rule of this.ordered) for (const actorId of this.whoOf(rule)) this.evaluate(rule, actorId, ev);
  }

  private onPhaseChange(ev: TraceEvent): void {
    for (const m of this.sortedRoster) {
      const u = this.sim.units.get(m.id);
      const spot = this.assignment(m.id);
      if (!u || !u.alive || u.speedYdPerSec <= 0 || spot === null || this.moving.has(m.id)) continue;
      const target = this.spotOf(spot);
      const dest = u.move ? u.move.to : u.pos;
      if (dest.x === target.x && dest.y === target.y) continue;
      this.sim.startMove(m.id, target, [ev.id]);
      this.moving.set(m.id, 1);
    }
  }

  private evaluate(rule: Rule, actorId: string, ev: TraceEvent): void {
    const w = rule.when;
    const d = ev.data;
    switch (w.on) {
      case 'aura_applied':
        if (ev.kind === 'aura_applied' && d.aura === w.aura && this.refMatches(w.target, actorId, d.unit)) this.fire(rule, actorId, [ev.id]);
        return;
      case 'cast_start':
        if (ev.kind === 'cast_start' && d.spell === w.spell && this.refMatches(w.caster, actorId, d.caster)) this.fire(rule, actorId, [ev.id]);
        return;
      case 'aura_stacks': {
        if (ev.kind !== 'aura_applied' && ev.kind !== 'aura_stack' && ev.kind !== 'aura_removed') return;
        if (d.aura !== w.aura || typeof d.unit !== 'string') return;
        const stacks = ev.kind === 'aura_removed' ? 0 : Number(d.stacks);
        this.condition(rule, actorId, d.unit, stacks >= w.atLeast, ev.id, this.refMatches(w.target, actorId, d.unit));
        return;
      }
      case 'health_below': {
        if (ev.kind !== 'damage' && ev.kind !== 'heal') return;
        if (typeof d.target !== 'string') return;
        const u = this.sim.unit(d.target);
        this.condition(rule, actorId, d.target, u.alive && (u.health / u.maxHealth) * 100 < w.pct, ev.id, this.refMatches(w.target, actorId, d.target));
        return;
      }
      case 'time':
        return;
    }
  }

  /**
   * Per-unit edge detection. State is updated for every matching unit; `eligible` (the unit currently matches the
   * trigger's reference, e.g. is the tank) only gates firing, so a false edge is never missed while a unit is off-reference.
   */
  private condition(rule: Rule, actorId: string, unitId: string, isTrue: boolean, cause: string, eligible: boolean): void {
    const key = `${rule.id}|${actorId}|${unitId}`;
    const was = this.active.get(key) ?? false;
    if (!isTrue) {
      this.active.set(key, false);
      return;
    }
    if (was || !eligible) return;
    if (this.fire(rule, actorId, [cause])) this.active.set(key, true);
  }

  private refMatches(ref: string, actorId: string, unitId: TraceValue | undefined): boolean {
    if (typeof unitId !== 'string') return false;
    if (ref === 'self') return unitId === actorId;
    if (ref === 'current_tank') return this.hooks.currentTank()?.id === unitId;
    if (ref === 'boss') return this.sim.bosses().some((b) => b.id === unitId);
    return ref === unitId;
  }

  private fire(rule: Rule, actorId: string, causes: readonly string[]): boolean {
    const actor = this.sim.units.get(actorId);
    if (!actor || !actor.alive || this.sim.over) return false;
    const key = `${rule.id}|${actorId}`;
    const last = this.lastFired.get(key);
    if (last !== undefined && this.sim.now < last + rule.cooldownMs) return false;
    this.lastFired.set(key, this.sim.now);
    const fired = this.sim.emit('rule_fired', { rule: rule.id, actor: actorId }, causes);
    const reaction = this.members.get(actorId)!.reaction;
    const delay = this.sim.rng.stream(`unit:${actorId}.reaction`).int(reaction.minMs, reaction.maxMs);
    this.sim.at(this.sim.now + delay, EventClass.Decision, () => this.execute(rule, actorId, fired, 0));
    return true;
  }

  private execute(rule: Rule, actorId: string, cause: string, attempt: number): void {
    const actor = this.sim.unit(actorId);
    if (!actor.alive || this.sim.over) return;
    let result: ActionResult;
    const running = this.moving.get(actorId);
    if (MOVE_ACTIONS.has(rule.do.do) && running !== undefined && running >= rule.priority) {
      result = { ok: false, reason: 'busy' };
    } else {
      const handler = this.handlers.get(rule.do.do);
      result = handler ? handler(this.context(rule, actor, [cause])) : { ok: false, reason: 'no_handler' };
    }
    if (result.ok) return;
    this.sim.emit('action_failed', { rule: rule.id, actor: actorId, action: rule.do.do, reason: result.reason, attempt }, [cause]);
    if (rule.retry && attempt < rule.retry.times) {
      this.sim.at(this.sim.now + rule.retry.everyMs, EventClass.Decision, () => this.execute(rule, actorId, cause, attempt + 1));
    }
  }

  private spotOf(id: string): Vec2 {
    const s = this.plan.spots[id];
    if (!s) throw new Error(`unknown spot ${id}`);
    return s;
  }

  private context(rule: Rule, actor: Unit, causes: readonly string[]): ActionContext {
    return {
      sim: this.sim,
      actor,
      rule,
      action: rule.do,
      causes,
      resolve: (ref) => {
        if (ref === 'self') return actor;
        if (ref === 'current_tank') return this.hooks.currentTank();
        if (ref === 'boss') return this.sim.bosses()[0] ?? null;
        return this.sim.units.get(ref) ?? null;
      },
      spot: (id) => this.spotOf(id),
      assignment: () => this.assignment(actor.id),
      markMoving: () => {
        this.moving.set(actor.id, rule.priority);
      },
    };
  }
}
