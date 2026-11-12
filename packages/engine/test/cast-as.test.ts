import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { makeBossContext } from '../src/boss';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 14, maxDurationMs: 3000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.addUnit({ ...body, id: 'p2', name: 'P2', kind: 'player', role: 'ranged', pos: { x: 6, y: 0 } });
  sim.catalog.addSpell({
    id: 'splash',
    castTimeMs: 0,
    gcdMs: 0,
    cooldownMs: 0,
    rangeYd: 0,
    usableWhileMoving: true,
    target: 'self',
    effects: [{ type: 'area', radius: 8, center: 'caster', relation: 'ally', excludeCaster: true, effects: [{ type: 'damage', school: 'shadow', min: 100, max: 100 }] }],
  });
  return sim;
}

const starts = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'cast_start');

describe('casting as another unit (A-020)', () => {
  it('a boss script makes another unit cast; the trace names the original caster', () => {
    const sim = newSim();
    sim.at(0, EventClass.AiUpdate, () => void makeBossContext(sim, 'boss').castAs('p1', 'splash', 'p1', [], { triggered: true }));
    sim.run();
    expect(starts(sim)[0].data).toMatchObject({ caster: 'p1', target: 'p1', triggered: true, originalCaster: 'boss' });
    expect(sim.trace.list().find((e) => e.kind === 'damage')?.data).toMatchObject({ target: 'p2', source: 'p1', amount: 100 });
  });

  it('an aura hook makes the holder cast', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'spore', durationMs: 1000, maxStacks: 1 });
    sim.catalog.addAuraScript('spore', {
      afterRemove: (c) => void startCast(c.sim, c.unitId, 'splash', c.unitId, c.causes, { triggered: true, originalCasterId: c.casterId }),
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    sim.run();
    const removed = sim.trace.list().find((e) => e.kind === 'aura_removed')!;
    const start = starts(sim)[0];
    expect(start.t).toBe(1000);
    expect(start.causes).toEqual([removed.id]);
    expect(start.data).toMatchObject({ caster: 'p1', originalCaster: 'boss' });
  });

  it("a triggered cast by a player leaves the player's own cast and GCD alone", () => {
    const sim = newSim();
    sim.catalog.addSpell({ id: 'bolt', castTimeMs: 2000, gcdMs: 1500, cooldownMs: 0, rangeYd: 40, usableWhileMoving: false, target: 'unit', effects: [{ type: 'damage', school: 'fire', min: 1, max: 1 }] });
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'p1', 'bolt', 'boss', []));
    sim.at(500, EventClass.AiUpdate, () => {
      makeBossContext(sim, 'boss').castAs('p1', 'splash', 'p1', [], { triggered: true });
      expect(sim.unit('p1').cast?.spellId).toBe('bolt');
      expect(sim.unit('p1').gcdUntilMs).toBe(1500);
    });
    sim.run();
    expect(sim.trace.list().find((e) => e.kind === 'cast_success' && e.data.spell === 'bolt')?.t).toBe(2000);
  });

  it('rejects an unknown original caster', () => {
    const sim = newSim();
    expect(() => startCast(sim, 'p1', 'splash', 'p1', [], { triggered: true, originalCasterId: 'ghost' })).toThrow(/unknown unit ghost/);
  });
});
