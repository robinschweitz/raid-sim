import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 9, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', pos: { x: 0, y: 0 } });
  for (const id of ['p1', 'p2', 'p3']) sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.catalog.addAura({
    id: 'spores',
    durationMs: 6000,
    maxStacks: 5,
    stackScope: 'unit_replace',
    periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'shadow', min: 10, max: 10 }] },
  });
  return sim;
}

describe("stack scope 'unit_replace' (A-016)", () => {
  it('a different caster replaces the old instance: removed with reason replaced, then the new one is applied', () => {
    const sim = newSim();
    const removed: unknown[] = [];
    const applied: string[] = [];
    sim.catalog.addAuraScript('spores', {
      afterApply: (c) => void applied.push(c.casterId),
      afterRemove: (c) =>
        void removed.push({ reason: c.reason, caster: c.casterId, appliedMs: c.appliedMs, refreshedMs: c.refreshedMs, expiresMs: c.expiresMs, now: c.sim.now }),
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'p2', 'p1', []));
    sim.at(500, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'p3', 'p1', []));
    sim.run();
    expect(removed).toEqual([{ reason: 'replaced', caster: 'p2', appliedMs: 0, refreshedMs: 0, expiresMs: 6000, now: 500 }]);
    expect(applied).toEqual(['p2', 'p3']);
    const at500 = sim.trace.list().filter((e) => e.t === 500);
    expect(at500.map((e) => [e.kind, e.data.caster])).toEqual([['aura_removed', 'p2'], ['aura_applied', 'p3']]);
    expect([...sim.unit('p1').auras.values()].map((a) => a.casterId)).toEqual(['p3']);
  });

  it('the same caster still stacks and refreshes', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'p2', 'p1', []));
    sim.at(500, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'p2', 'p1', []));
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'aura_stack').map((e) => e.data.stacks)).toEqual([2]);
    expect(sim.trace.list().some((e) => e.kind === 'aura_removed')).toBe(false);
  });

  it('hooks report expiresMs, null for a permanent aura', () => {
    const sim = newSim();
    const seen: (number | null)[] = [];
    sim.catalog.addAura({ id: 'blight', durationMs: null, maxStacks: 1 });
    sim.catalog.addAuraScript('blight', { afterApply: (c) => void seen.push(c.expiresMs) });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'blight', 'boss', 'boss', []));
    sim.run();
    expect(seen).toEqual([null]);
  });

  it('the replacing instance fixes its own periodic amounts and area flag', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'p2', 'p1', [], { viaArea: true }));
    sim.at(500, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'p3', 'p1', [], { viaArea: false }));
    sim.at(501, EventClass.SpellHit, () => {
      const inst = [...sim.unit('p1').auras.values()][0]!;
      expect(inst.casterId).toBe('p3');
      expect(inst.viaArea).toBe(false);
      expect(inst.stacks).toBe(1);
      expect(inst.periodicAmounts).toEqual([10]);
    });
    sim.run();
  });
});
