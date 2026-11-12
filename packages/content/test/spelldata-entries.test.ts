import { readFileSync } from 'node:fs';
import { DataRegistry, PINS } from '@raid/data';
import { describe, expect, it } from 'vitest';
import { spellDataEntries, spellKey } from '../src/spelldata/entries';
import { parseSpellDataFile } from '../src/spelldata/file';

const FILE = parseSpellDataFile(JSON.parse(readFileSync(new URL('../data/spelldata/festergut.json', import.meta.url), 'utf8')));
const spell = (id: number) => FILE.spells.find((s) => s.id === id)!;

describe('spell data entries', () => {
  it('builds entries the data registry accepts, with derived effect ranges', () => {
    const data = new DataRegistry(spellDataEntries(FILE, [71219, 72101, 69157, 72228]));
    // Expected numbers are read from the file, so the test cannot drift from the extraction.
    const e0 = (id: number) => spell(id).effects[0]!;
    expect(data.num('spell.71219.e0.min')).toBe(e0(71219).basePoints + 1);
    expect(data.num('spell.71219.e0.max')).toBe(e0(71219).basePoints + e0(71219).dieSides);
    expect(data.num('spell.72228.e0.min')).toBe(e0(72228).basePoints + 1);
    expect(data.num('spell.72228.e0.max')).toBe(e0(72228).basePoints + e0(72228).dieSides);
    expect(data.num('spell.72101.e0.min')).toBe(e0(72101).basePoints + 1);
    expect(data.num('spell.72101.e0.max')).toBe(e0(72101).basePoints + e0(72101).dieSides);
    expect(data.num('spell.71219.cast_time_ms')).toBe(spell(71219).castTimeMs);
    expect(data.num('spell.71219.e0.radius_yd')).toBe(e0(71219).radiusYd!.radius);
    expect(data.num('spell.71219.school_mask')).toBe(spell(71219).schoolMask);
    expect(data.num('spell.72101.max_stacks')).toBe(spell(72101).stackAmount);
    expect(data.num('spell.69157.duration_ms')).toBe(spell(69157).durationMs!.base);
    // The values the research and the plan quote, as a check on the file itself.
    expect([71219, 72228, 72101].map((id) => [data.num(`spell.${id}.e0.min`), data.num(`spell.${id}.e0.max`)])).toEqual([
      [48750, 51250],
      [29250, 30750],
      [-25, -25],
    ]);
  });

  it('sources raw fields as spelldata with the version of their file, computed values as derived', () => {
    const entries = spellDataEntries(FILE, [71219]);
    const of = (key: string) => entries.find((e) => e.key === key)?.source;
    const version = (name: string) => FILE.files.find((f) => f.name === name)!.dataVersion;
    expect(of(spellKey(71219, 'e0.base_points'))).toEqual({
      kind: 'spelldata',
      spellId: 71219,
      field: 'EffectBasePoints[0]',
      dataVersion: version('Spell.dbc'),
    });
    expect(of('spell.71219.cast_time_ms')).toMatchObject({ kind: 'spelldata', dataVersion: version('SpellCastTimes.dbc') });
    expect(of('spell.71219.e0.radius_yd')).toMatchObject({ kind: 'spelldata', dataVersion: version('SpellRadius.dbc') });
    expect(of('spell.71219.e0.min')).toMatchObject({ kind: 'derived', inputs: ['spell.71219.e0.base_points', 'spell.71219.e0.die_sides'] });
    expect(entries.some((e) => e.key === 'spell.71219.duration_ms')).toBe(false);
    for (const e of entries) {
      if (e.source.kind === 'spelldata') expect(PINS.spellDataVersions).toContain(e.source.dataVersion);
    }
  });

  it('rejects unknown spells, unpinned file versions and files with missing spells', () => {
    expect(() => spellDataEntries(FILE, [1])).toThrow(/spell 1 is not in the spell data file/);
    const unpinned = {
      ...FILE,
      files: FILE.files.map((f) => (f.name === 'Spell.dbc' ? { ...f, dataVersion: 'client-12340:Spell.dbc:000000000000' } : f)),
    };
    expect(() => spellDataEntries(unpinned, [71219])).toThrow(/Spell.dbc version client-12340:Spell.dbc:000000000000 is not pinned/);
    expect(() => spellDataEntries({ ...FILE, missing: [5] }, [71219])).toThrow(/missing from the client data: 5/);
  });
});
