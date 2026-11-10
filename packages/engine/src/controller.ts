import { startCast } from './casting';
import { centerDistance, positionAt } from './movement';
import { EventClass, type Scheduled } from './queue';
import type { Simulation } from './sim';
import type { TraceEvent } from './trace';
import type { Unit, Vec2 } from './units';
import { buildView, type ActorView } from './view';

export type PolicyAction =
  | { readonly type: 'cast'; readonly spell: string; readonly target: string }
  | { readonly type: 'move'; readonly to: Vec2 }
  /**
   * `retryAtMs` asks to be woken at that absolute time. It is ignored unless finite; fractions round up to the next
   * whole millisecond; a time at or before now is ignored (use events or cooldowns to wake sooner).
   */
  | { readonly type: 'none'; readonly retryAtMs?: number };

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
/** More decisions than this by one actor in one millisecond means a wake loop. */
const MAX_DECISIONS_PER_MS = 64;

export class ActorController {
  private pending: Scheduled | null = null;
  private pendingAt = Number.POSITIVE_INFINITY;
  private deciding = false;
  private decisionMs = -1;
  private decisionCount = 0;

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
    if (this.sim.now !== this.decisionMs) {
      this.decisionMs = this.sim.now;
      this.decisionCount = 0;
    }
    if (++this.decisionCount > MAX_DECISIONS_PER_MS) {
      throw new Error(`actor ${this.actorId} decided more than ${MAX_DECISIONS_PER_MS} times at ${this.sim.now} ms: likely a wake loop`);
    }
    this.deciding = true;
    let retryAtMs: number | undefined;
    let hitBound = true;
    let moved = false;
    try {
      for (let i = 0; i < MAX_ACTIONS_PER_WAKE; i++) {
        if (self.cast) {
          hitBound = false;
          break;
        }
        const view = buildView(this.sim, this.actorId, this.hooks.spots(), this.hooks.assignment(this.actorId));
        const action = this.policy.decide(view);
        if (action.type === 'none') {
          retryAtMs = action.retryAtMs;
          hitBound = false;
          break;
        }
        if (action.type === 'move') {
          const here = positionAt(self, this.sim.now);
          // At most one started move per wake-up; a cast may still follow it.
          if (moved) {
            hitBound = false;
            break;
          }
          // Less than one millisecond of travel counts as already there.
          const arrivesAtOnce = centerDistance(here, action.to) < self.speedYdPerSec / 1000;
          const sameDestination = self.move !== null && self.move.to.x === action.to.x && self.move.to.y === action.to.y;
          // Moving to the current position would arrive at once and wake the actor again in the same millisecond.
          if (arrivesAtOnce || sameDestination || self.speedYdPerSec <= 0 || this.hooks.isRuleMoving(this.actorId)) {
            hitBound = false;
            break;
          }
          this.sim.startMove(this.actorId, action.to, []);
          moved = true;
          continue;
        }
        const gcdBefore = self.gcdUntilMs;
        const result = startCast(this.sim, this.actorId, action.spell, action.target, []);
        if (!result.ok) {
          hitBound = false;
          break;
        }
        const offGcdInstant = self.gcdUntilMs === gcdBefore && !self.cast;
        if (!offGcdInstant) {
          hitBound = false;
          break;
        }
      }
    } finally {
      this.deciding = false;
    }
    if (hitBound) this.wake(this.sim.now + 1);
    else if (retryAtMs !== undefined && Number.isFinite(retryAtMs)) {
      const at = Math.ceil(retryAtMs);
      if (at > this.sim.now) this.wake(at);
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
