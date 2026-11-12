import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import type { AuraDef, SpellDef } from '../src/catalog';
import { installCoreRules, startCast } from '../src/casting';
import { applyEffects } from '../src/effects';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 1000000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim(maxDurationMs = 6000) {
  const sim = new Simulation({ seed: 8, maxDurationMs, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.catalog.addAura({ id: 'fury', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_done_pct', pct: 100, perStack: false }] });
  sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false }] });
  return sim;
}

const dot = (id: string, min: number, max: number, extra: Partial<AuraDef> = {}): AuraDef => ({
  id,
  durationMs: 3000,
  maxStacks: 3,
  periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'shadow', min, max }] },
  ...extra,
});

const ticks = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'damage').map((e) => [e.t, e.data.amount]);

describe('periodic amounts (A-029)', () => {
  it('rolls the amount once per application', () => {
    const sim = newSim();
    sim.catalog.addAura(dot('rot', 100, 200));
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'rot', 'boss', 'p1', []));
    sim.run();
    const amounts = ticks(sim).map(([, a]) => a as number);
    expect(amounts).toHaveLength(3);
    expect(new Set(amounts).size).toBe(1);
    expect(amounts[0]).toBeGreaterThanOrEqual(100);
    expect(amounts[0]).toBeLessThanOrEqual(200);
  });

  it('multiplies the amount by the stacks', () => {
    const sim = newSim();
    sim.catalog.addAura(dot('rot', 100, 100));
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'rot', 'boss', 'p1', []);
      applyAura(sim, 'rot', 'boss', 'p1', []);
    });
    sim.run();
    expect(ticks(sim)).toEqual([[1000, 200], [2000, 200], [3000, 200]]);
  });

  it('takes the caster done factors at application and the target factors at each tick', () => {
    const sim = newSim(3000);
    sim.catalog.addAura(dot('rot', 100, 100));
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'rot', 'boss', 'p1', []));
    sim.at(1500, EventClass.SpellHit, () => {
      applyAura(sim, 'fury', 'boss', 'boss', []);
      applyAura(sim, 'ward', 'p1', 'p1', []);
    });
    sim.at(2500, EventClass.SpellHit, () => void applyAura(sim, 'rot', 'boss', 'p1', []));
    sim.run();
    // 3000: 100 × 2 (fury, taken at the re-application) × 2 stacks × 0.5 (ward at the tick).
    expect(ticks(sim)).toEqual([[1000, 100], [2000, 50], [3000, 200]]);
  });

  it('truncates after each step: the done factor at application, then the stacks, then the taken factor per tick', () => {
    const sim = newSim(1000);
    sim.catalog.addAura({ id: 'boon', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_done_pct', pct: 10, perStack: false }] });
    sim.catalog.addAura({ id: 'frail', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: 15, perStack: false }] });
    sim.catalog.addAura(dot('rot', 33, 33));
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'boon', 'boss', 'boss', []);
      applyAura(sim, 'frail', 'p1', 'p1', []);
      applyAura(sim, 'rot', 'boss', 'p1', []);
      applyAura(sim, 'rot', 'boss', 'p1', []);
    });
    sim.run();
    // Re-application with 2 stacks: trunc(33 × 1.1) = 36 (not 36.3), × 2 = 72, then trunc(72 × 1.15) = 82 (82.8).
    expect(ticks(sim)).toEqual([[1000, 82]]);
  });

  it('applies area damage avoidance at each tick of an aura an area applied', () => {
    const sim = newSim();
    sim.catalog.addAura(dot('rot', 100, 100));
    sim.catalog.addAura({ id: 'inoculated', durationMs: null, maxStacks: 3, stackScope: 'unit', modifiers: [{ kind: 'aoe_damage_taken_pct', pct: -25, perStack: true, schools: ['shadow'] }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'inoculated', 'p1', 'p1', []);
      applyAura(sim, 'inoculated', 'p1', 'p1', []);
      applyEffects(sim, [{ type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'apply_aura', aura: 'rot' }] }], { casterId: 'boss', targetId: 'boss', ability: 'cloud', causes: [] });
    });
    sim.run();
    expect(ticks(sim)).toEqual([[1000, 50], [2000, 50], [3000, 50]]);
  });

  it('ignores the caster done factors for an aura that says so', () => {
    const sim = newSim();
    sim.catalog.addAura(dot('spores', 100, 100, { ignoreCasterDamageMods: true }));
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'fury', 'boss', 'boss', []);
      applyAura(sim, 'spores', 'boss', 'p1', []);
    });
    sim.run();
    expect(ticks(sim)).toEqual([[1000, 100], [2000, 100], [3000, 100]]);
  });
  describe('ignoreCasterDamageMods of the applying spell (A-028, A-029)', () => {
    const applier = (effect: SpellDef['effects'][number]): SpellDef => ({
      id: 'plague',
      castTimeMs: 0,
      gcdMs: 0,
      cooldownMs: 0,
      rangeYd: 100,
      usableWhileMoving: true,
      target: 'unit',
      ignoreCasterDamageMods: true,
      effects: [effect],
    });
    const cast = (sim: Simulation) => {
      installCoreRules(sim);
      sim.at(0, EventClass.SpellHit, () => {
        applyAura(sim, 'fury', 'boss', 'boss', []);
        startCast(sim, 'boss', 'plague', 'p1', []);
      });
    };

    it('a flagged spell applies a DoT whose ticks skip the caster done factor', () => {
      const sim = newSim();
      sim.catalog.addAura(dot('rot', 100, 100));
      sim.catalog.addSpell(applier({ type: 'apply_aura', aura: 'rot' }));
      cast(sim);
      sim.run();
      expect(ticks(sim)).toEqual([[1000, 100], [2000, 100], [3000, 100]]);
    });

    it('also through an area effect leaf', () => {
      const sim = newSim();
      sim.catalog.addAura(dot('rot', 100, 100));
      sim.catalog.addSpell(applier({ type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'apply_aura', aura: 'rot' }] }));
      cast(sim);
      sim.run();
      expect(ticks(sim)).toEqual([[1000, 100], [2000, 100], [3000, 100]]);
    });

    it('through an area effect run outside a spell launch (effect context)', () => {
      const sim = newSim();
      sim.catalog.addAura(dot('rot', 100, 100));
      sim.at(0, EventClass.SpellHit, () => {
        applyAura(sim, 'fury', 'boss', 'boss', []);
        applyEffects(sim, [{ type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'apply_aura', aura: 'rot' }] }], {
          casterId: 'boss', targetId: 'boss', ability: 'cloud', causes: [], ignoreCasterMods: true,
        });
      });
      sim.run();
      expect(ticks(sim)[0]).toEqual([1000, 100]);
    });

    it('a re-stack by an unflagged source keeps the flag; an unflagged spell still takes the factor', () => {
      const sim = newSim();
      sim.catalog.addAura(dot('rot', 100, 100));
      sim.catalog.addSpell(applier({ type: 'apply_aura', aura: 'rot' }));
      cast(sim);
      sim.at(500, EventClass.SpellHit, () => void applyAura(sim, 'rot', 'boss', 'p1', []));
      sim.run();
      // Two stacks, both without the done factor.
      expect(ticks(sim)).toEqual([[1000, 200], [2000, 200], [3000, 200]]);
      const plain = newSim();
      plain.catalog.addAura(dot('rot', 100, 100));
      plain.at(0, EventClass.SpellHit, () => {
        applyAura(plain, 'fury', 'boss', 'boss', []);
        applyAura(plain, 'rot', 'boss', 'p1', []);
      });
      plain.run();
      expect(ticks(plain)[0]).toEqual([1000, 200]);
    });
  });
});
