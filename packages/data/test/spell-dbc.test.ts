import { describe, expect, it } from 'vitest';
import { DBC_FORMATS, SPELL_COLUMNS, decodeSpell, difficultyVariants, loadClientSpellData } from '../src/dbc/spell';
import { buildWdbc } from './dbc-builder';

function spellRow(values: Partial<Record<keyof typeof SPELL_COLUMNS, number | string>>, effects: Record<number, Record<string, number>> = {}): (number | string)[] {
  const row: (number | string)[] = Array.from({ length: DBC_FORMATS.Spell.length }, (_, i) => (DBC_FORMATS.Spell[i] === 's' ? '' : 0));
  for (const [k, v] of Object.entries(values)) row[SPELL_COLUMNS[k as keyof typeof SPELL_COLUMNS]] = v!;
  for (const [i, e] of Object.entries(effects)) for (const [k, v] of Object.entries(e)) row[SPELL_COLUMNS[k as keyof typeof SPELL_COLUMNS] + Number(i)] = v;
  return row;
}

describe('spell DBC layout', () => {
  it('has the AzerothCore 3.3.5a spell format (234 columns)', () => {
    expect(DBC_FORMATS.Spell).toHaveLength(234);
    expect([...DBC_FORMATS.Spell].filter((c) => c !== 'x')).toHaveLength(187);
  });

  it('points every column at the right column type', () => {
    const fmt = DBC_FORMATS.Spell;
    expect(fmt[SPELL_COLUMNS.id]).toBe('n');
    expect(fmt[SPELL_COLUMNS.speed]).toBe('f');
    expect(fmt[SPELL_COLUMNS.name]).toBe('s');
    for (const k of ['effect', 'effectBasePoints', 'effectRadiusIndex', 'effectTriggerSpell', 'effectAmplitude'] as const) {
      for (let i = 0; i < 3; i++) expect(fmt[SPELL_COLUMNS[k] + i], `${k}[${i}]`).toBe('i');
    }
    for (const k of ['durationIndex', 'rangeIndex', 'castingTimeIndex', 'maxAffectedTargets', 'schoolMask', 'stackAmount'] as const) {
      expect(fmt[SPELL_COLUMNS[k]], k).toBe('i');
    }
  });
});

describe('decoding', () => {
  it('never reports variants for spell id 0, even when a row has empty (0) slots', () => {
    const data = loadClientSpellData({
      Spell: buildWdbc(DBC_FORMATS.Spell, []),
      SpellCastTimes: buildWdbc(DBC_FORMATS.SpellCastTimes, []),
      SpellDifficulty: buildWdbc(DBC_FORMATS.SpellDifficulty, [[1, 100, 101, 0, 0]]),
      SpellDuration: buildWdbc(DBC_FORMATS.SpellDuration, []),
      SpellRadius: buildWdbc(DBC_FORMATS.SpellRadius, []),
      SpellRange: buildWdbc(DBC_FORMATS.SpellRange, []),
    });
    expect(difficultyVariants(data, 0)).toBeNull();
  });

  it('pins every decoded field to its literal column', () => {
    const fmt = DBC_FORMATS.Spell;
    const row: (number | string)[] = Array.from({ length: fmt.length }, (_, i) =>
      fmt[i] === 's' ? `s${i}` : fmt[i] === 'f' ? i + 0.5 : fmt[i] === 'x' ? 0 : i + 1000,
    );
    // Expected values are written from literal zero-based columns (value = column + 1000, or + 0.5 for floats).
    const eff = (c: readonly number[], k: number) => c[k]! + 1000;
    const E = {
      effect: [71, 72, 73], dieSides: [74, 75, 76], basePoints: [80, 81, 82], implicitTargetA: [86, 87, 88],
      implicitTargetB: [89, 90, 91], radiusIndex: [92, 93, 94], applyAuraName: [95, 96, 97], amplitude: [98, 99, 100],
      chainTarget: [104, 105, 106], miscValue: [110, 111, 112], triggerSpell: [116, 117, 118],
    };
    const effectAt = (k: number) => ({
      effect: eff(E.effect, k), dieSides: eff(E.dieSides, k), basePoints: eff(E.basePoints, k),
      implicitTargetA: eff(E.implicitTargetA, k), implicitTargetB: eff(E.implicitTargetB, k),
      radiusIndex: eff(E.radiusIndex, k), applyAuraName: eff(E.applyAuraName, k), amplitude: eff(E.amplitude, k),
      chainTarget: eff(E.chainTarget, k), miscValue: eff(E.miscValue, k), triggerSpell: eff(E.triggerSpell, k),
    });
    expect(decodeSpell(row)).toEqual({
      id: 1000, attributes: 1004, attributesEx: 1005, castingTimeIndex: 1028, recoveryTime: 1029,
      categoryRecoveryTime: 1030, interruptFlags: 1031, auraInterruptFlags: 1032, procFlags: 1034,
      procChance: 1035, durationIndex: 1040, rangeIndex: 1046, speed: 47.5, stackAmount: 1049,
      name: 's136', startRecoveryCategory: 1205, startRecoveryTime: 1206, maxAffectedTargets: 1212,
      dmgClass: 1213, schoolMask: 1225,
      effects: [effectAt(0), effectAt(1), effectAt(2)],
    });
    expect(effectAt(2).triggerSpell).toBe(1118);
  });

  it('decodes a spell row and its effects', () => {
    const row = spellRow(
      { id: 69278, name: 'Gas Spore', durationIndex: 9, schoolMask: 8, maxAffectedTargets: 3, castingTimeIndex: 1 },
      { 0: { effect: 6, effectApplyAuraName: 4, effectBasePoints: -1, effectTriggerSpell: 69279, effectRadiusIndex: 13 } },
    );
    const s = decodeSpell(row);
    expect(s).toMatchObject({ id: 69278, name: 'Gas Spore', durationIndex: 9, schoolMask: 8, maxAffectedTargets: 3 });
    expect(s.effects[0]).toMatchObject({ effect: 6, applyAuraName: 4, basePoints: -1, triggerSpell: 69279, radiusIndex: 13 });
    expect(s.effects[1].effect).toBe(0);
  });

  it('loads all six files and finds difficulty variants', () => {
    const data = loadClientSpellData({
      Spell: buildWdbc(DBC_FORMATS.Spell, [spellRow({ id: 69278, name: 'Gas Spore' })]),
      SpellCastTimes: buildWdbc(DBC_FORMATS.SpellCastTimes, [[1, 0]]),
      SpellDifficulty: buildWdbc(DBC_FORMATS.SpellDifficulty, [[500, 69278, 69279, 69280, 69281]]),
      SpellDuration: buildWdbc(DBC_FORMATS.SpellDuration, [[9, 12000, 0, 12000]]),
      SpellRadius: buildWdbc(DBC_FORMATS.SpellRadius, [[13, 8, 0, 8]]),
      SpellRange: buildWdbc(DBC_FORMATS.SpellRange, [[6, 0, 0, 100, 100, 0]]),
    });
    expect(data.spells.get(69278)?.name).toBe('Gas Spore');
    expect(data.radius.get(13)).toEqual({ radius: 8, perLevel: 0, max: 8 });
    expect(data.duration.get(9)).toEqual({ base: 12000, perLevel: 0, max: 12000 });
    expect(data.castTimes.get(1)).toEqual({ castTime: 0 });
    expect(data.ranges.get(6)).toEqual({ minHostile: 0, minFriendly: 0, maxHostile: 100, maxFriendly: 100, flags: 0 });
    expect(difficultyVariants(data, 69280)).toEqual([69278, 69279, 69280, 69281]);
    expect(difficultyVariants(data, 1)).toBeNull();
    expect(difficultyVariants(data, 0)).toBeNull();
  });
});
