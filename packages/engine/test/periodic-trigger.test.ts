import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const self = { castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: true, target: 'self' } as const;

function newSim() {
  const sim = new Simulation({ seed: 18, maxDurationMs: 13000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  for (const [id, x] of [['p1', 5], ['p2', 6], ['p3', 20], ['tank', 5.5]] as const) sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x, y: 0 } });
  sim.catalog.addAura({ id: 'blight', durationMs: 6000, maxStacks: 1 });
  sim.catalog.addSpell({ ...self, id: 'blighted_spores', effects: [{ type: 'area', radius: 8, center: 'caster', relation: 'ally', effects: [{ type: 'apply_aura', aura: 'blight' }] }] });
  sim.catalog.addAura({ id: 'spore_holder', durationMs: 12000, maxStacks: 1, periodic: { intervalMs: 12000, effects: [{ type: 'periodic_trigger', spell: 'blighted_spores' }] } });
  return sim;
}

describe('periodic_trigger and instakill (A-030)', () => {
  it('the holder casts at the tick; a single tick at expiry comes before the removal', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spore_holder', 'boss', 'p1', []));
    sim.run();
    const at = sim.trace.list().filter((e) => e.t === 12000);
    expect(at.map((e) => e.kind)).toEqual([
      'periodic_tick',
      'cast_start',
      'cast_success',
      'spell_hit',
      'aura_applied',
      'spell_hit',
      'aura_applied',
      'spell_hit',
      'aura_applied',
      'aura_removed',
    ]);
    expect(at[1].data).toMatchObject({ caster: 'p1', spell: 'blighted_spores', originalCaster: 'boss' });
    expect(at[1].causes).toContain(at[0].id);
    // The holder casts, but the spell is cast for the aura's caster (the boss): it owns the applied auras (A-020).
    expect(at.filter((e) => e.kind === 'aura_applied').map((e) => [e.data.unit, e.data.caster])).toEqual([
      ['p1', 'boss'],
      ['p2', 'boss'],
      ['tank', 'boss'],
    ]);
  });

  it('instakill deals the remaining health as damage, without modifiers', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false }] });
    sim.catalog.addSpell({
      ...self,
      id: 'explosion',
      effects: [
        { type: 'area', radius: 10, center: 'caster', relation: 'ally', effects: [{ type: 'damage', school: ['nature', 'shadow'], min: 100, max: 100 }] },
        { type: 'on_caster', effects: [{ type: 'instakill' }] },
      ],
    });
    sim.at(0, EventClass.SpellHit, () => {
      sim.damage('tank', 60000, { sourceId: 'boss', ability: 'prior', school: 'physical' }, []);
      applyAura(sim, 'ward', 'tank', 'tank', []);
      startCast(sim, 'tank', 'explosion', 'tank', [], { triggered: true, originalCasterId: 'boss' });
    });
    sim.run();
    const hits = sim.trace.list().filter((e) => e.kind === 'damage' && e.data.ability === 'explosion');
    expect(hits.map((e) => [e.data.target, e.data.amount])).toEqual([['p1', 100], ['p2', 100], ['tank', 40000]]);
    // Current health, not maximum; dealt by the casting unit (not the original caster), physical, no overkill.
    expect(hits[2].data).toMatchObject({ source: 'tank', school: 'physical', overkill: 0 });
    expect(sim.unit('tank').alive).toBe(false);
  });

  it('periodic_trigger is an aura effect', () => {
    const sim = newSim();
    expect(() => sim.catalog.addSpell({ ...self, id: 'bad', effects: [{ type: 'periodic_trigger', spell: 'blighted_spores' }] })).toThrow(
      /bad: periodic_trigger is an aura effect/,
    );
  });

  it('periodic_trigger must be a top-level periodic effect', () => {
    const sim = newSim();
    const trig = { type: 'periodic_trigger', spell: 'blighted_spores' } as const;
    expect(() => sim.catalog.addAura({ id: 'bad1', durationMs: 1000, maxStacks: 1, onExpire: [trig] })).toThrow(/bad1: periodic_trigger must be a top-level/);
    expect(() =>
      sim.catalog.addAura({ id: 'bad2', durationMs: 1000, maxStacks: 1, periodic: { intervalMs: 500, effects: [{ type: 'on_caster', effects: [trig] }] } }),
    ).toThrow(/bad2: periodic_trigger must be a top-level/);
    expect(() =>
      sim.catalog.addAura({ id: 'bad3', durationMs: 1000, maxStacks: 1, periodic: { intervalMs: 500, effects: [{ type: 'area', radius: 3, center: 'caster', relation: 'any', effects: [trig] }] } }),
    ).toThrow(/bad3: periodic_trigger must be a top-level/);
  });

  it('instakill on a unit with 40 health records overkill-free damage of 40 and runs the death hooks', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'mark', durationMs: 5000, maxStacks: 1 });
    const calls: string[] = [];
    sim.catalog.addAuraScript('mark', { afterRemove: (c) => void calls.push(c.reason) });
    sim.catalog.addSpell({ ...self, id: 'doom', effects: [{ type: 'instakill' }] });
    sim.at(0, EventClass.SpellHit, () => {
      sim.damage('p1', 99960, { sourceId: 'boss', ability: 'x', school: 'physical' }, []);
      applyAura(sim, 'mark', 'boss', 'p1', []);
      startCast(sim, 'p1', 'doom', 'p1', [], { triggered: true });
    });
    sim.run();
    const last = sim.trace.list().filter((e) => e.kind === 'damage').at(-1)!;
    expect(last.data).toMatchObject({ target: 'p1', source: 'p1', ability: 'doom', amount: 40, overkill: 0 });
    expect(calls).toEqual(['death']);
  });
});
