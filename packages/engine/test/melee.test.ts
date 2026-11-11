import { describe, expect, it } from 'vitest';
import { EventScriptedAI, attachBoss, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { armorReduction, creatureMeleeDamage, meleeIfReady } from '../src/melee';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { ThreatManager } from '../src/threat';

describe('armor reduction (Unit::CalcArmorReducedDamage)', () => {
  it('matches the worked examples', () => {
    expect(armorReduction(26000, 83)).toBeCloseTo(26000 / (26000 + 16635), 6);
    expect(armorReduction(0, 83)).toBe(0);
    expect(armorReduction(1e6, 83)).toBe(0.75);
  });
});

describe('creature melee damage (Creature::CalculateMinMaxDamage)', () => {
  it('Festergut 10n worked example', () => {
    expect(creatureMeleeDamage({ baseDamage: 177.074, attackPower: 805, variance: 1, damageModifier: 75, attackTimeMs: 2000 })).toEqual({ min: 35186, max: 48466 });
  });
});

class Idle extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [];
  protected engage(_ctx: BossContext): void {}
  protected executeEvent(): void {}
}

function newSim(avoidance = { missPct: 0, dodgePct: 0, parryPct: 0 }) {
  const sim = new Simulation({ seed: 3, maxDurationMs: 6500, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, level: 83, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 8, boundingRadius: 0.31, melee: { minDamage: 10000, maxDamage: 10000, attackTimeMs: 2000 } });
  sim.addUnit({ id: 't1', name: 'T1', kind: 'player', role: 'tank', maxHealth: 1e6, armor: 16635, avoidance, pos: { x: 10, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  attachBoss(sim, new Idle(), 'boss', 10);
  threat.add('boss', 't1', 1);
  return sim;
}

describe('boss melee', () => {
  it('swings every attack interval at the victim, mitigated by armor', () => {
    const sim = newSim();
    sim.run();
    const swings = sim.trace.list().filter((e) => e.kind === 'damage' && e.data.ability === 'melee');
    expect(swings.map((e) => e.t)).toEqual([10, 2010, 4010, 6010]);
    expect(swings[0].data.amount).toBe(5000); // armor 16635 at level 83 halves the damage
  });

  it('records avoided swings', () => {
    const sim = newSim({ missPct: 0, dodgePct: 100, parryPct: 0 });
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'melee_avoided').map((e) => e.data.result)).toEqual(['dodge', 'dodge', 'dodge', 'dodge']);
  });

  it('does not swing out of melee range or while casting', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      sim.unit('t1').pos = { x: 30, y: 0 };
    });
    sim.run();
    expect(meleeIfReady(sim, 'boss', sim.unit('t1'))).toBeNull();
    expect(sim.trace.list().some((e) => e.data.ability === 'melee')).toBe(false);
  });
});
