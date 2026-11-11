import { describe, expect, it } from 'vitest';
import { EventScriptedAI, attachBoss, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { applyAura } from '../src/auras';
import { startCast } from '../src/casting';
import { armorReduction, creatureMeleeDamage, meleeIfReady, meleeOutcome } from '../src/melee';
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

function newSim(avoidance = { missPct: 0, dodgePct: 0, parryPct: 0 }, armor = 16635, rawDamage = 10000) {
  const sim = new Simulation({ seed: 3, maxDurationMs: 6500, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, level: 83, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 8, boundingRadius: 0.31, melee: { minDamage: rawDamage, maxDamage: rawDamage, attackTimeMs: 2000 } });
  sim.addUnit({ id: 't1', name: 'T1', kind: 'player', role: 'tank', maxHealth: 1e6, armor, avoidance, pos: { x: 10, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
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

const swingsOf = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'damage' && e.data.ability === 'melee');

describe('boss melee details', () => {
  it('rounds the armor-reduced hit up like AzerothCore, before modifiers', () => {
    // armor 200 at level 83: 10000 * (1 - reduction) = 9881.1999
    const red = armorReduction(200, 83);
    expect(10000 * (1 - red)).toBeCloseTo(9881.1999, 3);
    const sim = newSim(undefined, 200, 10000);
    sim.run();
    expect(swingsOf(sim)[0].data.amount).toBe(9882); // ceil(9881.1999); Math.round would give 9881
  });

  it('an armor-0 victim takes the raw amount', () => {
    const sim = newSim(undefined, 0, 12345);
    sim.run();
    expect(swingsOf(sim)[0].data.amount).toBe(12345);
  });

  it('a damage_taken_pct aura on the victim changes the swing', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -20, perStack: false }] });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'ward', 't1', 't1', []));
    sim.run();
    expect(swingsOf(sim)[0].data.amount).toBe(4000); // 5000 after armor, times 0.8
  });

  it('first swing lands at the first AI update once the victim is in range', () => {
    const sim = newSim();
    sim.unit('t1').pos = { x: 30, y: 0 };
    sim.at(3000, EventClass.SpellHit, () => {
      sim.unit('t1').pos = { x: 3, y: 0 };
    });
    sim.run();
    expect(swingsOf(sim).map((e) => e.t)).toEqual([3000, 5000]);
  });

  it('does not swing while casting; swings after the cast ends', () => {
    const sim = newSim();
    sim.catalog.addSpell({ id: 'channelish', castTimeMs: 3000, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: false, target: 'self', effects: [] });
    sim.at(5, EventClass.Decision, () => {
      expect(startCast(sim, 'boss', 'channelish', 'boss', []).ok).toBe(true);
    });
    sim.run();
    expect(swingsOf(sim).map((e) => e.t)).toEqual([3010, 5010]);
  });
});

describe('melee outcome table', () => {
  it('rounds each chance to whole hundredths', () => {
    const av = { missPct: 5.6, dodgePct: 0, parryPct: 0 };
    expect(meleeOutcome(0, av)).toBe('miss');
    expect(meleeOutcome(559, av)).toBe('miss');
    expect(meleeOutcome(560, av)).toBe('hit');
  });
  it('a 100 % single chance always produces that outcome', () => {
    for (const roll of [0, 5000, 9999]) {
      expect(meleeOutcome(roll, { missPct: 100, dodgePct: 0, parryPct: 0 })).toBe('miss');
      expect(meleeOutcome(roll, { missPct: 0, dodgePct: 100, parryPct: 0 })).toBe('dodge');
      expect(meleeOutcome(roll, { missPct: 0, dodgePct: 0, parryPct: 100 })).toBe('parry');
    }
  });
  it('orders miss, dodge, parry', () => {
    const av = { missPct: 1, dodgePct: 2, parryPct: 3 };
    expect([99, 100, 299, 300, 599, 600].map((r) => meleeOutcome(r, av))).toEqual(['miss', 'dodge', 'dodge', 'parry', 'parry', 'hit']);
  });
});
