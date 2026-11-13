import { centerDistance, positionAt } from './movement';
import type { Simulation } from './sim';
import { threatFor } from './threat';
import type { Vec2 } from './units';

/** AzerothCore CONTACT_DISTANCE (ObjectDefines.h 23): the chase stops this far beyond both combat reaches. */
export const CHASE_CONTACT_DISTANCE_YD = 0.5;
/** ChaseMovementGenerator's distance recheck, "Sniffed value" (TargetedMovementGenerator.cpp 279); here also the re-path spacing (A-040). */
export const CHASE_REPATH_MS = 400;
/** Arrival on the chase point counts as in position despite float rounding. */
const EPSILON_YD = 1e-9;

/**
 * ChaseMovementGenerator<Creature> without range or angle, as MoveChase(victim) sets it up from UnitAI::AttackStart
 * (UnitAI.cpp 29–33, ScriptedAI::AttackStart, ScriptedCreature.cpp 228–234), in 2D and in straight lines (A-040).
 * `update` runs on every AI update before the script, like Unit::Update's UpdateMotion (Unit.cpp 643) before
 * UpdateAI (Creature.cpp 899).
 */
export class Chaser {
  private victimId: string | null = null;
  private aim: Vec2 | null = null;
  private pathMs = Number.NEGATIVE_INFINITY;
  private lastTargetEvent: string | null = null;

  constructor(
    private readonly sim: Simulation,
    private readonly bossId: string,
  ) {
    // The victim may have been chosen before the chaser exists (the engage's first threat reference).
    this.lastTargetEvent = [...sim.trace.list()].reverse().find((ev) => ev.kind === 'threat_target' && ev.data.boss === bossId)?.id ?? null;
    sim.subscribe((ev) => {
      if (ev.kind === 'threat_target' && ev.data.boss === bossId) this.lastTargetEvent = ev.id;
    });
  }

  update(): void {
    const sim = this.sim;
    const self = sim.unit(this.bossId);
    if (!self.alive || sim.over || !(self.speedYdPerSec > 0)) return;
    const victim = threatFor(sim)?.victim(this.bossId) ?? null;
    // DoUpdate 227–240: casting (IsMovementPreventedByCasting, Creature.cpp 3710–3730: UNIT_STATE_CASTING) or a lost
    // target (HasLostTarget, TargetedMovementGenerator.h 58) stops the movement and forgets the target position.
    if (!victim || self.cast) {
      if (self.move) sim.stopMove(self.id, self.cast ? [self.cast.startEvent] : this.causes());
      this.aim = null;
      if (!victim) this.victimId = null;
      return;
    }
    const newVictim = victim.id !== this.victimId;
    this.victimId = victim.id;
    const from = positionAt(self, sim.now);
    const to = positionAt(victim, sim.now);
    const distance = centerDistance(from, to);
    // maxTarget = CONTACT_DISTANCE + GetChaseRange (both combat reaches), DoUpdate 252 and 256; PositionOkay 47–63.
    const maxTarget = self.combatReach + victim.combatReach + CHASE_CONTACT_DISTANCE_YD;
    if (distance <= maxTarget + EPSILON_YD) {
      // 283–295: in position, stop (the source waits for a still victim and the 400 ms recheck; A-040).
      // A move that arrives this millisecond ends with its own move_end (decisions run after AI updates, A-001).
      if (self.move && self.move.arrivalMs > sim.now) sim.stopMove(self.id, this.causes());
      this.aim = null;
      return;
    }
    const victimMoved = this.aim !== null && (this.aim.x !== to.x || this.aim.y !== to.y);
    const due = !self.move || newVictim || this.aim === null || (victimMoved && sim.now - this.pathMs >= CHASE_REPATH_MS);
    if (!due) return;
    // 375–380 and 189–190: path to the victim's centre, cut maxTarget short of it (ShortenPathUntilDist).
    const k = (distance - maxTarget) / distance;
    const dest = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    this.aim = to;
    this.pathMs = sim.now;
    sim.startMove(self.id, dest, this.causes());
  }

  private causes(): string[] {
    return this.lastTargetEvent ? [this.lastTargetEvent] : [];
  }
}
