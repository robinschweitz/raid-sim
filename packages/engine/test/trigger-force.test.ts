import { describe, expect, it } from 'vitest';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const self = { castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: true, target: 'self' } as const;

function newSim() {
  const sim = new Simulation({ seed: 16, maxDurationMs: 4000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  for (const [id, x] of [['p1', 5], ['p2', 6], ['p3', 7]] as const) sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x, y: 0 } });
  sim.catalog.addAura({ id: 'inhaled', durationMs: null, maxStacks: 3 });
  sim.catalog.addAura({ id: 'holder', durationMs: 12000, maxStacks: 1 });
  sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false }] });
  sim.catalog.addSpell({ ...self, id: 'inhaled_blight', effects: [{ type: 'apply_aura', aura: 'inhaled' }] });
  return sim;
}

describe('trigger_spell and force_cast (A-030)', () => {
  it('trigger_spell casts at launch, triggered, before the spell hits', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...self, id: 'inhale', castTimeMs: 3500, effects: [{ type: 'script' }, { type: 'trigger_spell', spell: 'inhaled_blight', on: 'caster' }] });
    sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'inhale', 'boss', []));
    sim.run();
    const at = sim.trace.list().filter((e) => e.t === 3500).map((e) => `${e.kind}:${e.data.spell ?? e.data.aura}`);
    expect(at).toEqual([
      'cast_success:inhale',
      'cast_start:inhaled_blight',
      'cast_success:inhaled_blight',
      'spell_hit:inhaled_blight',
      'aura_applied:inhaled',
      'spell_hit:inhale',
    ]);
    // The owner is the casting unit itself, so no redundant originalCaster is recorded.
    const trig = sim.trace.list().find((e) => e.kind === 'cast_start' && e.data.spell === 'inhaled_blight')?.data;
    expect(trig).toMatchObject({ triggered: true });
    expect(trig).not.toHaveProperty('originalCaster');
  });

  it('damage of earlier units is fixed before a later trigger, and dealt after it', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...self, id: 'warding', effects: [{ type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'apply_aura', aura: 'ward' }] }] });
    sim.catalog.addSpell({
      ...self,
      id: 'pungent',
      effects: [
        { type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'damage', school: 'shadow', min: 1000, max: 1000 }] },
        { type: 'trigger_spell', spell: 'warding', on: 'caster' },
      ],
    });
    sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'pungent', 'boss', []));
    sim.run();
    const list = sim.trace.list();
    expect(list.filter((e) => e.kind === 'damage').map((e) => e.data.amount)).toEqual([1000, 1000, 1000]);
    const lastWard = list.map((e) => e.kind === 'aura_applied' && e.data.aura === 'ward').lastIndexOf(true);
    const firstDamage = list.findIndex((e) => e.kind === 'damage');
    expect(lastWard).toBeLessThan(firstDamage);
  });

  it('force_cast makes every unit hit cast the spell on itself', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...self, id: 'spore_holder', effects: [{ type: 'apply_aura', aura: 'holder' }] });
    sim.catalog.addSpell({ ...self, id: 'gas_spore', effects: [{ type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'force_cast', spell: 'spore_holder' }] }] });
    sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'gas_spore', 'boss', [], { triggered: true }));
    sim.run();
    // FORCE_CAST passes no original caster (SpellEffects.cpp 1081–1096), so each forced unit owns its own aura.
    for (const id of ['p1', 'p2', 'p3']) expect(sim.unit(id).auras.has(`holder|${id}`), id).toBe(true);
    const forced = sim.trace.list().filter((e) => e.kind === 'cast_start' && e.data.spell === 'spore_holder');
    expect(forced.map((e) => [e.data.caster, e.data.target, e.data.originalCaster])).toEqual([
      ['p1', 'p1', undefined],
      ['p2', 'p2', undefined],
      ['p3', 'p3', undefined],
    ]);
  });

  it('passes the original caster to the triggered cast and to the aura it applies', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...self, id: 'inhale', effects: [{ type: 'trigger_spell', spell: 'inhaled_blight', on: 'caster' }] });
    sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'inhale', 'boss', [], { triggered: true, originalCasterId: 'p1' }));
    sim.run();
    const start = sim.trace.list().find((e) => e.kind === 'cast_start' && e.data.spell === 'inhaled_blight');
    expect(start?.data).toMatchObject({ caster: 'boss', triggered: true, originalCaster: 'p1' });
    expect(sim.unit('boss').auras.get('inhaled|p1')?.casterId).toBe('p1');
  });

  it('force_cast from a spell cast for another unit still makes the forced unit own the aura', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...self, id: 'spore_holder', effects: [{ type: 'apply_aura', aura: 'holder' }] });
    sim.catalog.addSpell({ ...self, id: 'gas_spore', effects: [{ type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'force_cast', spell: 'spore_holder' }] }] });
    sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'gas_spore', 'boss', [], { triggered: true, originalCasterId: 'p1' }));
    sim.run();
    for (const id of ['p1', 'p2', 'p3']) expect(sim.unit(id).auras.get(`holder|${id}`)?.casterId, id).toBe(id);
    expect(sim.unit('p2').auras.has('holder|p1')).toBe(false);
  });

  it('trigger_spell on the target casts at the explicit target', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...self, id: 'mark_target', target: 'unit', rangeYd: 50, effects: [{ type: 'trigger_spell', spell: 'tag', on: 'target' }] });
    sim.catalog.addSpell({ ...self, id: 'tag', target: 'unit', rangeYd: 50, effects: [{ type: 'apply_aura', aura: 'inhaled' }] });
    sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'mark_target', 'p2', []));
    sim.run();
    const start = sim.trace.list().find((e) => e.kind === 'cast_start' && e.data.spell === 'tag');
    expect(start?.data).toMatchObject({ caster: 'boss', target: 'p2', triggered: true });
    expect(sim.unit('p2').auras.has('inhaled|boss')).toBe(true);
    expect(sim.unit('p1').auras.size).toBe(0);
  });

  it('a trigger on the first unit of the deliveries changes the damage fixed for the later units', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...self, id: 'warding', effects: [{ type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'apply_aura', aura: 'ward' }] }] });
    sim.catalog.addSpell({
      ...self,
      id: 'pungent',
      target: 'unit',
      rangeYd: 50,
      effects: [
        { type: 'trigger_spell', spell: 'warding', on: 'caster' },
        { type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'damage', school: 'shadow', min: 1000, max: 1000 }] },
      ],
    });
    // The trigger entry sits on the boss, first in the deliveries; its cast warns all players before any damage is fixed.
    sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'pungent', 'p1', []));
    sim.run();
    const list = sim.trace.list();
    expect(list.filter((e) => e.kind === 'damage').map((e) => [e.data.target, e.data.amount])).toEqual([['p1', 500], ['p2', 500], ['p3', 500]]);
    const firstDamage = list.findIndex((e) => e.kind === 'damage');
    expect(list.slice(0, firstDamage).filter((e) => e.kind === 'aura_applied').length).toBe(3);
  });

  describe('trigger chains', () => {
    it('stop a spell that triggers itself', () => {
      const sim = newSim();
      sim.catalog.addSpell({ ...self, id: 'loop', effects: [{ type: 'trigger_spell', spell: 'loop', on: 'caster' }] });
      sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'loop', 'boss', [], { triggered: true }));
      expect(() => sim.run()).toThrow(/trigger depth > 16: spell chain loop->loop->/);
    });

    it('stop an A -> B -> A chain, also through force_cast, and leave the guard reset afterwards', () => {
      const sim = newSim();
      sim.catalog.addSpell({ ...self, id: 'a', effects: [{ type: 'trigger_spell', spell: 'b', on: 'caster' }] });
      sim.catalog.addSpell({ ...self, id: 'b', effects: [{ type: 'force_cast', spell: 'a' }] });
      sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'a', 'boss', [], { triggered: true }));
      expect(() => sim.run()).toThrow(/trigger depth > 16: spell chain a->b->a->b->/);
      expect(sim.castChain).toEqual([]);
    });

    it('allow a chain of exactly the limit', () => {
      const sim = newSim();
      for (let i = 0; i < 16; i++) {
        sim.catalog.addSpell({ ...self, id: `s${i}`, effects: i < 15 ? [{ type: 'trigger_spell', spell: `s${i + 1}`, on: 'caster' }] : [{ type: 'script' }] });
      }
      sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 's0', 'boss', [], { triggered: true }));
      expect(() => sim.run()).not.toThrow();
    });
  });

  it('only spells use trigger_spell', () => {
    const sim = newSim();
    expect(() =>
      sim.catalog.addAura({ id: 'bad', durationMs: 1000, maxStacks: 1, periodic: { intervalMs: 500, effects: [{ type: 'trigger_spell', spell: 'inhaled_blight', on: 'caster' }] } }),
    ).toThrow(/bad: trigger_spell is a spell effect/);
  });
});
