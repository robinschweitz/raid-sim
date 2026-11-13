import { describe, expect, it } from 'vitest';
import { EventScriptedAI, attachBoss, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { CHASE_CONTACT_DISTANCE_YD, CHASE_REPATH_MS } from '../src/chase';
import { centerDistance, positionAt } from '../src/movement';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { ThreatManager } from '../src/threat';

class ChaseAI extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [];
  constructor(
    readonly combatMovement: boolean = true,
    private readonly castAtMs: number | null = null,
  ) {
    super();
  }
  protected engage(_ctx: BossContext): void {
    if (this.castAtMs !== null) this.events.schedule(1, this.castAtMs);
  }
  protected executeEvent(id: number, ctx: BossContext): void {
    if (id === 1) ctx.cast('slow_cast', ctx.self.id, [ctx.ai('cast')]);
  }
}

/** Boss at the origin, reach 5; p1 at (x1, 0), p2 at (0, y2); players reach 1.5, so the chase distance is 6.5 + 0.5 = 7 yd. */
function newSim(x1: number, y2 = 40, maxDurationMs = 10000) {
  const sim = new Simulation({ seed: 3, maxDurationMs, sampleIntervalMs: 100 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e6, pos: { x: 0, y: 0 }, speedYdPerSec: 10, combatReach: 5, boundingRadius: 2, melee: { minDamage: 1, maxDamage: 1, attackTimeMs: 2000 } });
  sim.addUnit({ id: 'p1', name: 'p1', kind: 'player', role: 'tank', maxHealth: 1e6, pos: { x: x1, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  sim.addUnit({ id: 'p2', name: 'p2', kind: 'player', role: 'ranged', maxHealth: 1e6, pos: { x: 0, y: y2 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  threat.add('boss', 'p1', 100);
  threat.add('boss', 'p2', 0);
  sim.catalog.addSpell({ id: 'slow_cast', castTimeMs: 2000, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: false, target: 'self', effects: [] });
  return { sim, threat };
}

const moves = (sim: Simulation) => sim.trace.list().filter((e) => (e.kind === 'move_start' || e.kind === 'move_end') && e.data.unit === 'boss');
const bossHits = (sim: Simulation, target: string) => sim.trace.list().filter((e) => e.kind === 'damage' && e.data.source === 'boss' && e.data.target === target);

describe('creature chase (ChaseMovementGenerator, A-040)', () => {
  it('constants follow the source: CONTACT_DISTANCE 0.5 yd, the 400 ms recheck', () => {
    expect(CHASE_CONTACT_DISTANCE_YD).toBe(0.5);
    expect(CHASE_REPATH_MS).toBe(400);
  });

  it('walks to a victim out of melee range at its run speed and stops at both combat reaches + 0.5 yd', () => {
    const { sim } = newSim(37);
    attachBoss(sim, new ChaseAI(), 'boss', 10);
    sim.run();
    const m = moves(sim);
    expect(m.map((e) => [e.t, e.kind])).toEqual([
      [10, 'move_start'],
      [3010, 'move_end'],
    ]);
    // 37 - 7 = 30 yd at 10 yd/s.
    expect(m[0].data).toMatchObject({ fromX: 0, fromY: 0, toX: 30, toY: 0, arrivalMs: 3010 });
    expect(m[1].data).toMatchObject({ x: 30, y: 0, stopped: false });
    const boss = sim.unit('boss');
    expect(centerDistance(positionAt(boss, sim.now), sim.unit('p1').pos)).toBeCloseTo(7, 9);
    // It swings while still moving (DoMeleeAttackIfReady has no movement check): melee range is 6.5 + 4/3 yd, reached
    // at x = 29.17, so on the first AI update after 2926.7 ms.
    expect(bossHits(sim, 'p1')[0].t).toBe(2930);
    expect(bossHits(sim, 'p1')[0].t).toBeLessThan(m[1].t);
  });

  it('does not move while the victim is already within the chase distance', () => {
    const { sim } = newSim(7);
    attachBoss(sim, new ChaseAI(), 'boss', 10);
    sim.run();
    expect(moves(sim)).toEqual([]);
    expect(bossHits(sim, 'p1')[0].t).toBe(10);
  });

  it('a boss without combat movement never moves', () => {
    const { sim } = newSim(37);
    attachBoss(sim, new ChaseAI(false), 'boss', 10);
    sim.run();
    expect(moves(sim)).toEqual([]);
    expect(bossHits(sim, 'p1')).toEqual([]);
  });

  it('follows a new victim when the threat target changes', () => {
    const { sim, threat } = newSim(37, 40, 8000);
    attachBoss(sim, new ChaseAI(), 'boss', 10);
    // p2 gains more than 130 % of p1's threat at 0.9 s; the threat update at 1 s makes it the victim.
    sim.at(900, EventClass.Decision, () => threat.add('boss', 'p2', 1000));
    sim.run();
    const m = moves(sim);
    const target = sim.trace.list().find((e) => e.kind === 'threat_target' && e.data.target === 'p2')!;
    // The chase update at 1 s runs after the threat update: the boss, at (9.9, 0), turns to p2 at (0, 40) at once.
    expect(target.t).toBe(1000);
    expect(m.map((e) => [e.t, e.kind, e.data.stopped ?? null])).toEqual([
      [10, 'move_start', null],
      [1000, 'move_start', null],
      [m[2].t, 'move_end', false],
    ]);
    expect(m[1].causes).toEqual([target.id]);
    expect(m[1].data).toMatchObject({ fromX: 9.9, fromY: 0 });
    const boss = sim.unit('boss');
    expect(centerDistance(positionAt(boss, sim.now), sim.unit('p2').pos)).toBeCloseTo(7, 9);
    expect(bossHits(sim, 'p2').length).toBeGreaterThan(0);
  });

  it('re-paths at most every 400 ms while the victim runs, and stops once it is caught', () => {
    const { sim } = newSim(37, 40, 12000);
    attachBoss(sim, new ChaseAI(), 'boss', 10);
    sim.at(0, EventClass.Decision, () => sim.startMove('p1', { x: 47, y: 0 }, []));
    sim.run();
    const starts = moves(sim).filter((e) => e.kind === 'move_start');
    expect(starts.length).toBeGreaterThan(2);
    for (let i = 1; i < starts.length; i++) expect(starts[i].t - starts[i - 1].t).toBeGreaterThanOrEqual(400);
    const boss = sim.unit('boss');
    expect(boss.move).toBeNull();
    expect(centerDistance(positionAt(boss, sim.now), sim.unit('p1').pos)).toBeLessThanOrEqual(7 + 1e-9);
  });

  it('stops while casting (UNIT_STATE_CASTING) and walks on after the cast', () => {
    const { sim } = newSim(37);
    attachBoss(sim, new ChaseAI(true, 1000), 'boss', 10);
    sim.run();
    const castStart = sim.trace.list().find((e) => e.kind === 'cast_start' && e.data.caster === 'boss');
    expect(castStart?.t).toBe(1000);
    const m = moves(sim);
    expect(m.map((e) => [e.t, e.kind, e.data.stopped ?? null])).toEqual([
      [10, 'move_start', null],
      [1010, 'move_end', true],
      [3000, 'move_start', null],
      [m[3].t, 'move_end', false],
    ]);
    expect(m[1].causes).toEqual([castStart!.id]);
    // The cast ends at 3 s (spell hits run before AI updates); the chase update of the same millisecond walks on. No cast is interrupted.
    expect(sim.trace.list().filter((e) => e.kind === 'cast_interrupted')).toEqual([]);
  });

  it('a unit with speed 0 does not chase', () => {
    const sim = new Simulation({ seed: 3, maxDurationMs: 2000, sampleIntervalMs: 100 });
    sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e6, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 5, boundingRadius: 2 });
    sim.addUnit({ id: 'p1', name: 'p1', kind: 'player', role: 'tank', maxHealth: 1e6, pos: { x: 37, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
    const threat = new ThreatManager(sim, 1000);
    threat.install();
    threat.add('boss', 'p1', 1);
    attachBoss(sim, new ChaseAI(), 'boss', 10);
    sim.run();
    expect(moves(sim)).toEqual([]);
  });
});
