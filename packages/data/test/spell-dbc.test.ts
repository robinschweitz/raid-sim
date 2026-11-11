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
    for (const k of ['effectMechanic', 'effectSpellClassMask'] as const) expect(fmt[SPELL_COLUMNS[k]]).toBe('i');
    for (const k of ['effectRealPointsPerLevel', 'effectValueMultiplier', 'effectDamageMultiplier', 'effectBonusMultiplier'] as const) {
      for (let i = 0; i < 3; i++) expect(fmt[SPELL_COLUMNS[k] + i], `${k}[${i}]`).toBe('f');
    }
    for (const k of ['dispel', 'mechanic', 'targets', 'attributesEx7', 'spellFamilyName', 'spellFamilyFlags', 'preventionType'] as const) {
      expect(fmt[SPELL_COLUMNS[k]], k).toBe('i');
    }
    for (const k of ['durationIndex', 'rangeIndex', 'castingTimeIndex', 'maxAffectedTargets', 'schoolMask', 'stackAmount'] as const) {
      expect(fmt[SPELL_COLUMNS[k]], k).toBe('i');
    }
  });
});

describe('localized names', () => {
  it('takes the name from the first non-empty locale slot', () => {
    const row = spellRow({});
    row[SPELL_COLUMNS.name + 3] = 'Gasspore';
    expect(decodeSpell(row)).toMatchObject({ name: 'Gasspore', nameLocale: 3 });
  });

  it('gives an empty name and locale -1 when every slot is empty', () => {
    expect(decodeSpell(spellRow({}))).toMatchObject({ name: '', nameLocale: -1 });
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
      mechanic: eff([83, 84, 85], k), realPointsPerLevel: [77, 78, 79][k]! + 0.5, valueMultiplier: [101, 102, 103][k]! + 0.5,
      damageMultiplier: [216, 217, 218][k]! + 0.5, bonusMultiplier: [229, 230, 231][k]! + 0.5,
      classMask: [122 + 3 * k + 1000, 123 + 3 * k + 1000, 124 + 3 * k + 1000] as const,
    });
    expect(decodeSpell(row)).toEqual({
      id: 1000, attributes: 1004, attributesEx: 1005, castingTimeIndex: 1028, recoveryTime: 1029,
      categoryRecoveryTime: 1030, interruptFlags: 1031, auraInterruptFlags: 1032, procFlags: 1034,
      procChance: 1035, durationIndex: 1040, rangeIndex: 1046, speed: 47.5, stackAmount: 1049,
      name: 's136', nameLocale: 0, startRecoveryCategory: 1205, startRecoveryTime: 1206, maxAffectedTargets: 1212,
      dmgClass: 1213, schoolMask: 1225,
      attributesEx2: 1006, attributesEx3: 1007, attributesEx4: 1008, attributesEx5: 1009, attributesEx6: 1010, attributesEx7: 1011,
      dispel: 1002, mechanic: 1003, targets: 1016, spellFamilyName: 1208, spellFamilyFlags: [1209, 1210, 1211], preventionType: 1214,
      effects: [effectAt(0), effectAt(1), effectAt(2)],
    });
    expect(effectAt(2).triggerSpell).toBe(1118);
  });

  it('tolerates invalid UTF-8 in unused string columns but not in spell names', () => {
    const fmt = DBC_FORMATS.Spell;
    const row = spellRow({ id: 7 });
    const rankColumn = fmt.indexOf('s', SPELL_COLUMNS.name + 16);
    row[SPELL_COLUMNS.name] = 'Name';
    row[rankColumn] = 'BAD';
    const file = buildWdbc(fmt, [row]);
    const at = new TextEncoder().encode('BAD');
    const idx = file.findIndex((_, i) => file[i] === at[0] && file[i + 1] === at[1] && file[i + 2] === at[2]);
    file.set([0xff, 0xfe, 0xfd], idx);
    const load = (f: Uint8Array) =>
      loadClientSpellData({
        Spell: f,
        SpellCastTimes: buildWdbc(DBC_FORMATS.SpellCastTimes, []),
        SpellDifficulty: buildWdbc(DBC_FORMATS.SpellDifficulty, []),
        SpellDuration: buildWdbc(DBC_FORMATS.SpellDuration, []),
        SpellRadius: buildWdbc(DBC_FORMATS.SpellRadius, []),
        SpellRange: buildWdbc(DBC_FORMATS.SpellRange, []),
      });
    expect(load(file).spells.get(7)?.name).toBe('Name');
    const nameAt = new TextEncoder().encode('Name');
    const nIdx = file.findIndex((_, i) => nameAt.every((b, k) => file[i + k] === b));
    file.set([0xff, 0xfe, 0xfd, 0xfc], nIdx);
    expect(() => load(file)).toThrow('invalid UTF-8');
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
