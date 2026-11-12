import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import type { SpellDef } from '../src/catalog';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const blast = (id: string, relation: 'ally' | 'enemy', extra: Partial<SpellDef> = {}, amount = 1200): SpellDef => ({
  id,
  castTimeMs: 0,
  gcdMs: 0,
  cooldownMs: 0,
  rangeYd: 0,
  usableWhileMoving: true,
  target: 'self',
  effects: [{ type: 'area', radius: 50, center: 'caster', relation, effects: [{ type: 'damage', school: 'shadow', min: amount, max: amount }] }],
  ...extra,
});

function newSim(players: number) {
  const sim = new Simulation({ seed: 3, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  for (let i = 1; i <= players; i++) {
    const id = `p${String(i).padStart(2, '0')}`;
    sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x: 10 + i * 0.1, y: 0 } });
  }
  sim.catalog.addSpell(blast('explosion', 'ally'));
  sim.catalog.addSpell(blast('pulse', 'enemy'));
  return sim;
}

const amounts = (sim: Simulation) => [...new Set(sim.trace.list().filter((e) => e.kind === 'damage').map((e) => e.data.amount))];

describe('player-caster area rules (A-028)', () => {
  it('scales a player area hit on more than 10 units by 10 / units', () => {
    const twelve = newSim(12);
    twelve.at(0, EventClass.SpellHit, () => void startCast(twelve, 'p01', 'explosion', 'p01', [], { triggered: true }));
    twelve.run();
    expect(twelve.trace.list().filter((e) => e.kind === 'damage')).toHaveLength(12);
    expect(amounts(twelve)).toEqual([1000]);
    const ten = newSim(10);
    ten.at(0, EventClass.SpellHit, () => void startCast(ten, 'p01', 'explosion', 'p01', [], { triggered: true }));
    ten.run();
    expect(amounts(ten)).toEqual([1200]);
  });

  it('does not scale a creature area hit', () => {
    const sim = newSim(12);
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'pulse', 'boss', [], { triggered: true }));
    sim.run();
    expect(amounts(sim)).toEqual([1200]);
  });

  it('ignores the caster damage-done modifiers when the spell says so, but keeps the target ones', () => {
    const sim = newSim(2);
    sim.catalog.addAura({ id: 'bloat', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_done_pct', pct: 100, perStack: false }] });
    sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false }] });
    sim.catalog.addSpell(blast('pure', 'ally', { ignoreCasterDamageMods: true }));
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'bloat', 'p01', 'p01', []);
      applyAura(sim, 'ward', 'p02', 'p02', []);
      startCast(sim, 'p01', 'pure', 'p01', [], { triggered: true });
      startCast(sim, 'p01', 'explosion', 'p01', [], { triggered: true });
    });
    sim.run();
    const toP02 = sim.trace.list().filter((e) => e.kind === 'damage' && e.data.target === 'p02').map((e) => [e.data.ability, e.data.amount]);
    expect(toP02).toEqual([['pure', 600], ['explosion', 1200]]);
  });

  it('truncates after each step: done, taken, then the 10 / units cap', () => {
    const sim = newSim(12);
    sim.catalog.addAura({ id: 'up', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_done_pct', pct: 50, perStack: false }] });
    sim.catalog.addAura({ id: 'down', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -30, perStack: false }] });
    sim.catalog.addSpell(blast('odd', 'ally', {}, 1001));
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'up', 'p01', 'p01', []);
      applyAura(sim, 'down', 'p02', 'p02', []);
      startCast(sim, 'p01', 'odd', 'p01', [], { triggered: true });
    });
    sim.run();
    const dmg = (id: string) => sim.trace.list().find((e) => e.kind === 'damage' && e.data.target === id)!.data.amount;
    // p02: 1001 * 1.5 = 1501 (trunc), * 0.7 = 1050 (trunc; one rounding would give 1051), * 10 / 12 = 875 (trunc of 875.0)
    expect(dmg('p02')).toBe(875);
    // p03: 1501 * 10 / 12 = 1250.83 -> 1250
    expect(dmg('p03')).toBe(1250);
  });
});
