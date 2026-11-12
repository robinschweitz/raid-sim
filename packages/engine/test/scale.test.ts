import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import { withinMeleeRange } from '../src/movement';
import { Simulation } from '../src/sim';
import { scaleOf } from '../src/stats';

const body = { maxHealth: 100000, speedYdPerSec: 7, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 22, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', combatReach: 8, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 't1', name: 'T1', kind: 'player', role: 'tank', combatReach: 1.5, pos: { x: 14, y: 0 } });
  sim.catalog.addAura({ id: 'swell', durationMs: null, maxStacks: 3, modifiers: [{ kind: 'scale_pct', pct: 20, perStack: true }] });
  sim.catalog.addAura({ id: 'berserk', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'scale_pct', pct: 25, perStack: false }] });
  return sim;
}

describe('scale (A-032)', () => {
  it('adds scale amounts to the native scale 1 and scales the combat reach', () => {
    const sim = newSim();
    const boss = sim.unit('boss');
    for (let i = 0; i < 3; i++) applyAura(sim, 'swell', 'boss', 'boss', []);
    expect(scaleOf(sim, boss)).toBeCloseTo(1.6, 10);
    expect(boss.combatReach).toBeCloseTo(12.8, 10);
    applyAura(sim, 'berserk', 'boss', 'boss', []);
    expect(scaleOf(sim, boss)).toBeCloseTo(1.85, 10);
    expect(boss.combatReach).toBeCloseTo(14.8, 10);
    expect(boss.baseCombatReach).toBe(8);
  });

  it('moves melee range with the reach', () => {
    const sim = newSim();
    const boss = sim.unit('boss');
    const tank = sim.unit('t1');
    expect(withinMeleeRange(boss, tank, 0)).toBe(false); // 14 > 8 + 1.5 + 4/3
    for (let i = 0; i < 3; i++) applyAura(sim, 'swell', 'boss', 'boss', []);
    expect(withinMeleeRange(boss, tank, 0)).toBe(true); // 14 <= 12.8 + 1.5 + 4/3
  });

  it('restores the reach when the aura goes', () => {
    const sim = newSim();
    applyAura(sim, 'swell', 'boss', 'boss', []);
    applyAura(sim, 'swell', 'boss', 'boss', []);
    removeAuras(sim, 'boss', 'swell', 'removed', []);
    expect(sim.unit('boss').combatReach).toBe(8);
  });
});
