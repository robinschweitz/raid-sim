import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import type { SpellDef } from '../src/catalog';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { byId } from '../src/units';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const PLAYERS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const room = { type: 'area' as const, radius: 100, center: 'caster' as const, relation: 'enemy' as const };
const SPORES: SpellDef = {
  id: 'spores',
  castTimeMs: 0,
  gcdMs: 0,
  cooldownMs: 0,
  rangeYd: 0,
  usableWhileMoving: true,
  target: 'self',
  effects: [{ ...room, effects: [{ type: 'apply_aura', aura: 'spore' }] }],
};

function newSim(seed = 21) {
  const sim = new Simulation({ seed, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  PLAYERS.forEach((id, i) => sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x: 5 + i, y: 0 } }));
  sim.catalog.addAura({ id: 'spore', durationMs: 12000, maxStacks: 1 });
  sim.catalog.addAura({ id: 'tag', durationMs: 12000, maxStacks: 1 });
  return sim;
}

const holders = (sim: Simulation, aura = 'spore') => PLAYERS.filter((id) => sim.unit(id).auras.has(`${aura}|boss`));

describe('max targets at launch (A-027)', () => {
  it('keeps a random subset drawn from the named stream', () => {
    const sim = newSim();
    sim.catalog.addSpell(SPORES);
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 3, targetStream: 'boss:boss.gas_spore' }));
    sim.run();
    const expected = new Simulation({ seed: 21, maxDurationMs: 1, sampleIntervalMs: 1 }).rng
      .stream('boss:boss.gas_spore')
      .pick(PLAYERS.map((id) => ({ id })), 3)
      .sort(byId)
      .map((u) => u.id);
    expect(holders(sim)).toHaveLength(3);
    expect(holders(sim)).toEqual(expected);
  });

  it('uses the area maxTargets unless the cast overrides it', () => {
    const limited: SpellDef = { ...SPORES, effects: [{ ...room, maxTargets: 2, effects: [{ type: 'apply_aura', aura: 'spore' }] }] };
    const sim = newSim();
    sim.catalog.addSpell(limited);
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true }));
    sim.run();
    expect(holders(sim)).toHaveLength(2);
    const over = newSim();
    over.catalog.addSpell(limited);
    over.at(0, EventClass.SpellHit, () => void startCast(over, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 4 }));
    over.run();
    expect(holders(over)).toHaveLength(4);
  });

  it('draws nothing when no more units qualify than the limit', () => {
    const sim = newSim();
    sim.catalog.addSpell(SPORES);
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 6 }));
    sim.run();
    expect(holders(sim)).toEqual(PLAYERS);
    expect(sim.rng.usage()['unit:boss.spores.targets']).toBeUndefined();
  });

  it('effects with the same targeting share one subset', () => {
    const sim = newSim();
    sim.catalog.addSpell({
      ...SPORES,
      effects: [
        { ...room, effects: [{ type: 'apply_aura', aura: 'spore' }] },
        { ...room, effects: [{ type: 'apply_aura', aura: 'tag' }] },
      ],
    });
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 3 }));
    sim.run();
    expect(holders(sim)).toHaveLength(3);
    expect(holders(sim, 'tag')).toEqual(holders(sim, 'spore'));
  });

  it('rejects a maxTargets that is not a positive integer', () => {
    const sim = newSim();
    sim.catalog.addSpell(SPORES);
    expect(() => startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 0 })).toThrow(/invalid maxTargets 0/);
    expect(() => sim.catalog.addSpell({ ...SPORES, id: 'bad', effects: [{ ...room, maxTargets: 1.5, effects: [] }] })).toThrow(/bad: invalid maxTargets 1.5/);
  });

  it('draws from unit:<caster>.<spell>.targets when no stream is named', () => {
    const sim = newSim();
    sim.catalog.addSpell(SPORES);
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 3 }));
    sim.run();
    const expected = new Simulation({ seed: 21, maxDurationMs: 1, sampleIntervalMs: 1 }).rng
      .stream('unit:boss.spores.targets')
      .pick(PLAYERS.map((id) => ({ id })), 3)
      .sort(byId)
      .map((u) => u.id);
    expect(holders(sim)).toEqual(expected);
  });

  it('rejects an invalid targetStream when the cast starts, even if no subset would be drawn', () => {
    const sim = newSim();
    sim.catalog.addSpell(SPORES);
    sim.catalog.addSpell({ ...SPORES, id: 'slow', castTimeMs: 1000 });
    expect(() => startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 10, targetStream: 'Bad Stream' })).toThrow(/invalid stream name: Bad Stream/);
    expect(() => startCast(sim, 'boss', 'slow', 'boss', [], { maxTargets: 10, targetStream: '' })).toThrow(/invalid stream name/);
    expect(sim.trace.list().filter((e) => e.kind === 'cast_start')).toEqual([]);
  });

  it('an area in an aura tick uses its own maxTargets and the stream unit:<caster>.<aura>.targets', () => {
    const sim = newSim();
    sim.catalog.addAura({
      id: 'pulse',
      durationMs: 1000,
      maxStacks: 1,
      periodic: { intervalMs: 1000, effects: [{ ...room, maxTargets: 2, effects: [{ type: 'apply_aura', aura: 'spore' }] }] },
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'pulse', 'boss', 'boss', []));
    sim.run();
    expect(holders(sim)).toHaveLength(2);
    expect(sim.rng.usage()['unit:boss.pulse.targets']).toBeGreaterThan(0);
  });
});
