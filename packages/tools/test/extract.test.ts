import { DBC_FORMATS, SPELL_COLUMNS, loadClientSpellData } from '@raid/data';
import { describe, expect, it } from 'vitest';
import { buildWdbc } from '../../data/test/dbc-builder';
import { dataVersionOf, extractSpells, findDbcFiles, parseSpellIds } from '../src/extract';

function spell(id: number, name: string, triggers: number[] = []): (number | string)[] {
  const row: (number | string)[] = Array.from({ length: DBC_FORMATS.Spell.length }, (_, i) => (DBC_FORMATS.Spell[i] === 's' ? '' : 0));
  row[SPELL_COLUMNS.id] = id;
  row[SPELL_COLUMNS.name] = name;
  row[SPELL_COLUMNS.durationIndex] = 9;
  row[SPELL_COLUMNS.rangeIndex] = 6;
  triggers.forEach((t, i) => {
    row[SPELL_COLUMNS.effect + i] = 64;
    row[SPELL_COLUMNS.effectTriggerSpell + i] = t;
    row[SPELL_COLUMNS.effectRadiusIndex + i] = 13;
  });
  return row;
}

function data() {
  return loadClientSpellData({
    Spell: buildWdbc(DBC_FORMATS.Spell, [spell(100, 'Root', [200]), spell(200, 'Triggered'), spell(101, 'Root 25'), spell(300, 'Unrelated')]),
    SpellCastTimes: buildWdbc(DBC_FORMATS.SpellCastTimes, [[1, 0]]),
    SpellDifficulty: buildWdbc(DBC_FORMATS.SpellDifficulty, [[7, 100, 101, 0, 0]]),
    SpellDuration: buildWdbc(DBC_FORMATS.SpellDuration, [[9, 12000, 0, 12000]]),
    SpellRadius: buildWdbc(DBC_FORMATS.SpellRadius, [[13, 8, 0, 8]]),
    SpellRange: buildWdbc(DBC_FORMATS.SpellRange, [[6, 0, 0, 100, 100, 0]]),
  });
}

const files = [{ name: 'Spell.dbc', sha256: 'a'.repeat(64), dataVersion: dataVersionOf('Spell.dbc', 'a'.repeat(64)) }];

describe('extractSpells', () => {
  it('follows triggered spells and difficulty variants, and nothing else', () => {
    const x = extractSpells(data(), files, [100]);
    expect(x.spells.map((s) => s.id)).toEqual([100, 101, 200]);
    expect(x.missing).toEqual([]);
  });

  it('carries the name locale through', () => {
    const x = extractSpells(data(), files, [100]);
    expect(x.spells[0]).toMatchObject({ name: 'Root', nameLocale: 0 });
  });

  it('resolves durations, ranges and effect radii through their index tables', () => {
    const root = extractSpells(data(), files, [100]).spells[0];
    expect(root.durationMs).toEqual({ base: 12000, perLevel: 0, max: 12000 });
    expect(root.rangeYd).toEqual({ minHostile: 0, minFriendly: 0, maxHostile: 100, maxFriendly: 100 });
    expect(root.effects).toHaveLength(1);
    expect(root.effects[0]).toMatchObject({ index: 0, effect: 64, triggerSpell: 200, radiusYd: { radius: 8, max: 8 } });
    expect(root.difficultyVariants).toEqual([100, 101, 0, 0]);
  });

  it('carries the extra spell and effect fields', () => {
    const root = extractSpells(data(), files, [100]).spells[0];
    expect(root).toMatchObject({ attributesEx2: 0, attributesEx7: 0, dispel: 0, mechanic: 0, targets: 0, spellFamilyName: 0, spellFamilyFlags: [0, 0, 0], preventionType: 0 });
    expect(root.effects[0]).toMatchObject({ mechanic: 0, realPointsPerLevel: 0, valueMultiplier: 0, damageMultiplier: 0, bonusMultiplier: 0, classMask: [0, 0, 0] });
  });

  it('reports ids that are not in the client data', () => {
    expect(extractSpells(data(), files, [100, 999]).missing).toEqual([999]);
  });

  it('builds version strings from the file name and hash prefix', () => {
    expect(dataVersionOf('Spell.dbc', 'abcdef0123456789'.repeat(4))).toBe('client-12340:Spell.dbc:abcdef012345');
  });
});

describe('parseSpellIds', () => {
  it('parses a comma list with whitespace', () => {
    expect(parseSpellIds('69278, 69279,3')).toEqual([69278, 69279, 3]);
  });
  it('rejects bad tokens and empty input', () => {
    for (const bad of ['1,x', '1,,2', '0', '-5', '1.5', '1e3', '12abc', '1,']) expect(() => parseSpellIds(bad), bad).toThrow(/invalid spell id/);
    expect(() => parseSpellIds('1,x')).toThrow('invalid spell id "x"');
    expect(() => parseSpellIds('')).toThrow('no spell ids given');
    expect(() => parseSpellIds(' ')).toThrow('no spell ids given');
  });
});

describe('findDbcFiles', () => {
  const all = ['Spell.dbc', 'spellcasttimes.DBC', 'SpellDifficulty.dbc', 'SPELLDURATION.DBC', 'SpellRadius.dbc', 'SpellRange.dbc'];
  it('finds files case-insensitively', () => {
    const m = findDbcFiles([...all, 'other.txt']);
    expect(m.SpellCastTimes).toBe('spellcasttimes.DBC');
    expect(m.SpellDuration).toBe('SPELLDURATION.DBC');
    expect(Object.keys(m).sort()).toEqual(['Spell', 'SpellCastTimes', 'SpellDifficulty', 'SpellDuration', 'SpellRadius', 'SpellRange']);
  });
  it('lists all missing files', () => {
    expect(() => findDbcFiles(['Spell.dbc'])).toThrow('missing SpellCastTimes.dbc, SpellDifficulty.dbc, SpellDuration.dbc, SpellRadius.dbc, SpellRange.dbc');
  });
  it('rejects names that differ only by case', () => {
    expect(() => findDbcFiles([...all, 'SPELL.DBC'])).toThrow('two files match Spell.dbc: Spell.dbc, SPELL.DBC');
  });
});
