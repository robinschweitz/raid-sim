import { startCast } from './casting';
import { positionAt } from './movement';
import { EventClass, type Scheduled } from './queue';
import type { Simulation } from './sim';
import type { TraceEvent } from './trace';
import type { Unit, Vec2 } from './units';
import { buildView, type ActorView } from './view';

export type PolicyAction =
  | { readonly type: 'cast'; readonly spell: string; readonly target: string }
  | { readonly type: 'move'; readonly to: Vec2 }
  | { readonly type: 'none' };

/** A spec's decision policy (priority list, healer targeting). Plan 3 adds the real specs. */
export interface ActorPolicy {
  readonly wakeOn: { readonly anyHealthChange: boolean; readonly anyAuraChange: boolean };
  decide(view: ActorView): PolicyAction;
}

export interface ControllerHooks {
  isRuleMoving(actorId: string): boolean;
  spots(): Readonly<Record<string, Vec2>>;
  assignment(actorId: string): string | null;
}

/** Bound on actions in one wake-up; only off-GCD instants can chain. */
const MAX_ACTIONS_PER_WAKE = 4;

export class ActorController {
  private pending: Scheduled | null = null;
  private pendingAt = Number.POSITIVE_INFINITY;
  private deciding = false;

  constructor(
    private readonly sim: Simulation,
    readonly actorId: string,
    private readonly policy: ActorPolicy,
    private readonly hooks: ControllerHooks,
  ) {}

  install(): void {
    this.sim.subscribe((ev) => this.onEvent(ev));
    this.wake(this.sim.now);
  }

  /** Schedules a decision at `at` unless one is already due at or before it. */
  wake(at: number): void {
    if (this.pending && this.pendingAt <= at) return;
    if (this.pending) this.sim.cancel(this.pending);
    this.pendingAt = at;
    this.pending = this.sim.at(at, EventClass.Decision, () => {
      this.pending = null;
      this.pendingAt = Number.POSITIVE_INFINITY;
      this.decide();
    });
  }

  private onEvent(ev: TraceEvent): void {
    if (this.deciding || this.sim.outcome) return;
    if (!this.sim.unit(this.actorId).alive) return;
    const d = ev.data;
    switch (ev.kind) {
      case 'cast_success':
      case 'cast_failed':
        if (d.caster === this.actorId) this.wake(this.sim.now);
        return;
      case 'cast_interrupted':
      case 'move_end':
        if (d.unit === this.actorId) this.wake(this.sim.now);
        return;
      case 'aura_applied':
      case 'aura_stack':
      case 'aura_removed':
        if (d.unit === this.actorId || this.policy.wakeOn.anyAuraChange) this.wake(this.sim.now);
        return;
      case 'damage':
      case 'heal':
        if (d.target === this.actorId || this.policy.wakeOn.anyHealthChange) this.wake(this.sim.now);
        return;
      default:
        return;
    }
  }

  private decide(): void {
    const self = this.sim.unit(this.actorId);
    if (!self.alive || this.sim.outcome) return;
    this.deciding = true;
    try {
      for (let i = 0; i < MAX_ACTIONS_PER_WAKE; i++) {
        if (self.cast) break;
        const view = buildView(this.sim, this.actorId, this.hooks.spots(), this.hooks.assignment(this.actorId));
        const action = this.policy.decide(view);
        if (action.type === 'none') break;
        if (action.type === 'move') {
          const here = positionAt(self, this.sim.now);
          const already = here.x === action.to.x && here.y === action.to.y;
          // Moving to the current position would arrive at once and wake the actor again in the same millisecond.
          if (!already && !this.hooks.isRuleMoving(this.actorId)) this.sim.startMove(this.actorId, action.to, []);
          break;
        }
        const gcdBefore = self.gcdUntilMs;
        const result = startCast(this.sim, this.actorId, action.spell, action.target, []);
        if (!result.ok) break;
        const offGcdInstant = self.gcdUntilMs === gcdBefore && !self.cast;
        if (!offGcdInstant) break;
      }
    } finally {
      this.deciding = false;
    }
    this.scheduleFollowUp(self);
  }

  /** Wake again when the GCD or a cooldown ends; a running cast wakes the actor through cast_success. */
  private scheduleFollowUp(self: Unit): void {
    if (self.cast) return;
    const times = [self.gcdUntilMs, ...self.cooldowns.values()].filter((t) => t > this.sim.now);
    if (times.length > 0) this.wake(Math.min(...times));
  }
}
