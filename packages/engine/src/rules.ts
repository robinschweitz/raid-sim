import { interruptCast } from './casting';
import type { Action, Member, Plan, Rule } from './plan/schema';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import type { TraceEvent, TraceValue } from './trace';
import type { Unit, Vec2 } from './units';

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
  ctx.markMoving();
  ctx.sim.startMove(ctx.actor.id, ctx.spot(ctx.action.spot), ctx.causes);
  return { ok: true };
};

const returnToAssignment: ActionHandler = (ctx) => {
  const spot = ctx.assignment();
  if (spot === null) return { ok: false, reason: 'no_assignment' };
  ctx.markMoving();
  ctx.sim.startMove(ctx.actor.id, ctx.spot(spot), ctx.causes);
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

export class RuleEngine {
  /** actorId → priority of the running rule move. */
  private readonly moving = new Map<string, number>();
  private readonly active = new Map<string, boolean>();
  private readonly lastFired = new Map<string, number>();
  private readonly members: Map<string, Member>;
  private readonly ordered: Rule[];

  constructor(
    private readonly sim: Simulation,
    private readonly plan: Plan,
    private readonly handlers: ReadonlyMap<string, ActionHandler>,
    private readonly hooks: RuleHooks,
  ) {
    this.members = new Map(plan.roster.map((m) => [m.id, m]));
    this.ordered = [...plan.rules].sort(
      (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
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
        for (const actorId of rule.who) this.fire(rule, actorId, []);
      });
    }
  }

  private onEvent(ev: TraceEvent): void {
    if ((ev.kind === 'move_end' || ev.kind === 'death') && typeof ev.data.unit === 'string') this.moving.delete(ev.data.unit);
    if (ev.kind === 'phase_change') this.onPhaseChange(ev);
    for (const rule of this.ordered) for (const actorId of rule.who) this.evaluate(rule, actorId, ev);
  }

  private onPhaseChange(ev: TraceEvent): void {
    for (const m of this.plan.roster) {
      const u = this.sim.units.get(m.id);
      const spot = this.assignment(m.id);
      if (!u || !u.alive || spot === null || this.moving.has(m.id)) continue;
      this.sim.startMove(m.id, this.spotOf(spot), [ev.id]);
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
        if (d.aura !== w.aura || !this.refMatches(w.target, actorId, d.unit)) return;
        const stacks = ev.kind === 'aura_removed' ? 0 : Number(d.stacks);
        this.condition(rule, actorId, stacks >= w.atLeast, ev.id);
        return;
      }
      case 'health_below': {
        if (ev.kind !== 'damage' && ev.kind !== 'heal') return;
        if (!this.refMatches(w.target, actorId, d.target)) return;
        const u = this.sim.unit(String(d.target));
        this.condition(rule, actorId, u.alive && (u.health / u.maxHealth) * 100 < w.pct, ev.id);
        return;
      }
      case 'time':
        return;
    }
  }

  private condition(rule: Rule, actorId: string, isTrue: boolean, cause: string): void {
    const key = `${rule.id}|${actorId}`;
    const was = this.active.get(key) ?? false;
    this.active.set(key, isTrue);
    if (isTrue && !was) this.fire(rule, actorId, [cause]);
  }

  private refMatches(ref: string, actorId: string, unitId: TraceValue | undefined): boolean {
    if (typeof unitId !== 'string') return false;
    if (ref === 'self') return unitId === actorId;
    if (ref === 'current_tank') return this.hooks.currentTank()?.id === unitId;
    if (ref === 'boss') return this.sim.bosses().some((b) => b.id === unitId);
    return ref === unitId;
  }

  private fire(rule: Rule, actorId: string, causes: readonly string[]): void {
    const actor = this.sim.units.get(actorId);
    if (!actor || !actor.alive || this.sim.outcome) return;
    const key = `${rule.id}|${actorId}`;
    const last = this.lastFired.get(key);
    if (last !== undefined && this.sim.now < last + rule.cooldownMs) return;
    this.lastFired.set(key, this.sim.now);
    const fired = this.sim.emit('rule_fired', { rule: rule.id, actor: actorId }, causes);
    const reaction = this.members.get(actorId)!.reaction;
    const delay = this.sim.rng.stream(`unit:${actorId}.reaction`).int(reaction.minMs, reaction.maxMs);
    this.sim.at(this.sim.now + delay, EventClass.Decision, () => this.execute(rule, actorId, fired, 0));
  }

  private execute(rule: Rule, actorId: string, cause: string, attempt: number): void {
    const actor = this.sim.unit(actorId);
    if (!actor.alive || this.sim.outcome) return;
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
