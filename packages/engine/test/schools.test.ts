import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { applyEffects } from '../src/effects';
import { modifiedSpellDamage } from '../src/modifiers';
import { EventClass } from '../src/queue';
import { overlaps, schoolLabel, schoolMask, schoolsOfMask } from '../src/schools';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 2, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  return sim;
}

describe('school masks', () => {
  it('converts school sets to SpellSchoolMask bits and back', () => {
    expect(schoolMask('physical')).toBe(1);
    expect(schoolMask('shadow')).toBe(32);
    expect(schoolMask(['shadow', 'nature'])).toBe(40);
    expect(schoolsOfMask(40)).toEqual(['nature', 'shadow']);
    expect(schoolsOfMask(127)).toEqual(['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane']);
  });

  it('rejects empty sets and masks outside 1..127', () => {
    expect(() => schoolMask([])).toThrow(/at least one school/);
    expect(() => schoolsOfMask(0)).toThrow(/invalid school mask 0/);
    expect(() => schoolsOfMask(128)).toThrow(/invalid school mask 128/);
  });

  it('matches by overlap and labels several schools in bit order', () => {
    expect(overlaps(['nature', 'shadow'], 'shadow')).toBe(true);
    expect(overlaps(['nature', 'shadow'], ['physical', 'fire'])).toBe(false);
    expect(schoolLabel('fire')).toBe('fire');
    expect(schoolLabel(['shadow', 'nature'])).toBe('nature+shadow');
  });

  it('throws on an unknown school string', () => {
    expect(() => schoolMask('void' as never)).toThrow();
    expect(() => schoolMask(['shadow', 'void'] as never)).toThrow();
  });

  it('labels all seven schools the same whatever the input order', () => {
    const all = ['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane'] as const;
    const label = 'physical+holy+fire+nature+frost+shadow+arcane';
    expect(schoolLabel(all)).toBe(label);
    expect(schoolLabel([...all].reverse())).toBe(label);
    expect(schoolLabel([all[3], all[6], all[0], all[5], all[1], all[4], all[2]])).toBe(label);
  });
});

describe('damage with several schools', () => {
  it('a shadow modifier applies to nature + shadow damage, a physical one does not; the trace shows the label', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'shadow_ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false, schools: ['shadow'] }] });
    sim.catalog.addAura({ id: 'stone_skin', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false, schools: ['physical'] }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'shadow_ward', 'p1', 'p1', []);
      applyAura(sim, 'stone_skin', 'p1', 'p1', []);
      expect(modifiedSpellDamage(sim, 'boss', 'p1', ['nature', 'shadow'], 1000)).toBe(500);
      expect(modifiedSpellDamage(sim, 'boss', 'p1', 'nature', 1000)).toBe(1000);
      applyEffects(sim, [{ type: 'damage', school: ['nature', 'shadow'], min: 1000, max: 1000 }], { casterId: 'boss', targetId: 'p1', ability: 'vile_gas', causes: [] });
    });
    sim.run();
    expect(sim.trace.list().find((e) => e.kind === 'damage')?.data).toMatchObject({ school: 'nature+shadow', amount: 500 });
  });

  it('rejects an empty school list in a spell or a modifier', () => {
    const sim = newSim();
    expect(() =>
      sim.catalog.addSpell({ id: 'nothing', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: true, target: 'self', effects: [{ type: 'damage', school: [], min: 1, max: 1 }] }),
    ).toThrow(/nothing: a school set needs at least one school/);
    expect(() =>
      sim.catalog.addAura({ id: 'nowhere', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -10, perStack: false, schools: [] }] }),
    ).toThrow(/nowhere: a school set needs at least one school/);
  });
});
