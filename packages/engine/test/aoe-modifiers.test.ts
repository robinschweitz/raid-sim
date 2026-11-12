import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import type { AreaEffect, LeafEffect } from '../src/catalog';
import { applyEffects } from '../src/effects';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const shadow = (n: number) => ({ type: 'damage' as const, school: 'shadow' as const, min: n, max: n });
const around = (effects: LeafEffect[], radius = 30): AreaEffect => ({ type: 'area', radius, center: 'caster', relation: 'enemy', effects });
const ctx = (casterId: string, targetId: string) => ({ casterId, targetId, ability: 'test', causes: [] });

function newSim() {
  const sim = new Simulation({ seed: 6, maxDurationMs: 5000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.addUnit({ ...body, id: 'p2', name: 'P2', kind: 'player', role: 'ranged', pos: { x: 6, y: 0 } });
  sim.catalog.addAura({
    id: 'inoculated',
    durationMs: 120000,
    maxStacks: 3,
    stackScope: 'unit',
    modifiers: [{ kind: 'aoe_damage_taken_pct', pct: -25, perStack: true, schools: ['shadow'] }],
  });
  sim.catalog.addAura({ id: 'cloud', durationMs: 3000, maxStacks: 1, periodic: { intervalMs: 1000, effects: [shadow(1000)] } });
  return sim;
}

const damageTo = (sim: Simulation, id: string) => sim.trace.list().filter((e) => e.kind === 'damage' && e.data.target === id).map((e) => e.data.amount);
const inoculate = (sim: Simulation, id: string, stacks: number) => {
  for (let i = 0; i < stacks; i++) applyAura(sim, 'inoculated', id, id, []);
};

describe('area damage avoidance (A-026)', () => {
  it('reduces area damage per stack for overlapping schools only', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      inoculate(sim, 'p1', 3);
      applyEffects(sim, [around([shadow(1000)])], ctx('boss', 'boss'));
      applyEffects(sim, [around([{ type: 'damage', school: ['nature', 'shadow'], min: 1000, max: 1000 }])], ctx('boss', 'boss'));
      applyEffects(sim, [around([{ type: 'damage', school: 'nature', min: 1000, max: 1000 }])], ctx('boss', 'boss'));
    });
    sim.run();
    expect(damageTo(sim, 'p1')).toEqual([250, 250, 1000]);
    expect(damageTo(sim, 'p2')).toEqual([1000, 1000, 1000]);
  });

  it('does not reduce single-target damage', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      inoculate(sim, 'p1', 3);
      applyEffects(sim, [shadow(1000)], ctx('boss', 'p1'));
    });
    sim.run();
    expect(damageTo(sim, 'p1')).toEqual([1000]);
  });

  it('reduces the ticks of an aura an area applied, not of one applied directly', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      inoculate(sim, 'p1', 1);
      inoculate(sim, 'p2', 1);
      applyEffects(sim, [around([{ type: 'apply_aura', aura: 'cloud' }], 5.5)], ctx('boss', 'boss'));
      applyAura(sim, 'cloud', 'boss', 'p2', []);
    });
    sim.run();
    expect(damageTo(sim, 'p1')).toEqual([750, 750, 750]);
    expect(damageTo(sim, 'p2')).toEqual([1000, 1000, 1000]);
  });

  it('creature AoE avoidance applies only to a creature caster', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'hardened', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'creature_aoe_damage_taken_pct', pct: -50, perStack: false }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'hardened', 'p1', 'p1', []);
      applyEffects(sim, [around([shadow(1000)])], ctx('boss', 'boss'));
      applyEffects(sim, [{ type: 'area', radius: 30, center: 'caster', relation: 'ally', excludeCaster: true, effects: [shadow(1000)] }], ctx('p2', 'p2'));
    });
    sim.run();
    expect(damageTo(sim, 'p1')).toEqual([500, 1000]);
  });

  it('truncates after each step: damage done, damage taken, then the area reduction', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'weak', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -33, perStack: false }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'weak', 'p1', 'p1', []);
      inoculate(sim, 'p1', 1);
      applyEffects(sim, [around([shadow(1001)])], ctx('boss', 'boss'));
    });
    sim.run();
    // 1001 * 0.67 = 670.67 -> 670; 670 * 0.75 = 502.5 -> 502 (one rounding would give 503)
    expect(damageTo(sim, 'p1')).toEqual([502]);
  });
});
