import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import { withinMeleeRange } from '../src/movement';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { scaleOf } from '../src/stats';

const body = { maxHealth: 100000, speedYdPerSec: 7, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 22, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', combatReach: 8, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 't1', name: 'T1', kind: 'player', role: 'tank', combatReach: 1.5, pos: { x: 14, y: 0 } });
  sim.catalog.addAura({ id: 'swell', durationMs: null, maxStacks: 3, modifiers: [{ kind: 'scale_pct', pct: 20, perStack: true }] });
  sim.catalog.addAura({ id: 'brief', durationMs: 500, maxStacks: 1, modifiers: [{ kind: 'scale_pct', pct: 50, perStack: false }] });
  sim.catalog.addAura({ id: 'shrink', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'scale_pct', pct: -25, perStack: false }] });
  sim.catalog.addAura({ id: 'vanish', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'scale_pct', pct: -100, perStack: false }] });
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

  it('a scale aura that expires returns the reach to the base', () => {
    const sim = newSim();
    sim.at(100, EventClass.SpellHit, () => void applyAura(sim, 'brief', 'boss', 'boss', []));
    let during = 0;
    sim.at(300, EventClass.SpellHit, () => void (during = sim.unit('boss').combatReach));
    sim.run();
    expect(during).toBe(12);
    expect(sim.unit('boss').combatReach).toBe(8);
  });

  it('a negative scale amount shrinks the reach', () => {
    const sim = newSim();
    applyAura(sim, 'shrink', 'boss', 'boss', []);
    expect(scaleOf(sim, sim.unit('boss'))).toBeCloseTo(0.75, 10);
    expect(sim.unit('boss').combatReach).toBeCloseTo(6, 10);
  });

  it('clamps the scale to 0.01 for creatures and 0.1 for players (Unit.cpp 12833)', () => {
    const sim = newSim();
    applyAura(sim, 'vanish', 'boss', 'boss', []);
    applyAura(sim, 'vanish', 't1', 't1', []);
    expect(scaleOf(sim, sim.unit('boss'))).toBe(0.01);
    expect(sim.unit('boss').combatReach).toBeCloseTo(0.08, 10);
    expect(scaleOf(sim, sim.unit('t1'))).toBe(0.1);
    expect(sim.unit('t1').combatReach).toBeCloseTo(0.15, 10);
  });

  it('death removes the scale, also when a hook decided the fight and the aura is dropped silently', () => {
    const sim = newSim();
    sim.addUnit({ ...body, id: 't2', name: 'T2', kind: 'player', role: 'tank', combatReach: 1.5, pos: { x: 14, y: 1 } });
    sim.catalog.addAura({ id: 'aaa_hook', durationMs: null, maxStacks: 1 });
    // The hook of the first removed aura kills the last other player: the fight is a wipe, the rest is dropped silently.
    sim.catalog.addAuraScript('aaa_hook', { afterRemove: (c) => void c.sim.damage('t2', 1e9, { sourceId: 'boss', ability: 'x', school: 'physical' }, []) });
    applyAura(sim, 'aaa_hook', 'boss', 't1', []);
    applyAura(sim, 'swell', 't1', 't1', []);
    expect(sim.unit('t1').combatReach).toBeCloseTo(1.8, 10);
    sim.damage('t1', 1e9, { sourceId: 'boss', ability: 'x', school: 'physical' }, []);
    expect(sim.over).toBe(true);
    expect(sim.unit('t1').auras.size).toBe(0);
    expect(sim.unit('t1').combatReach).toBe(1.5);
  });
});
