import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpellDataFile, spellDataVersions } from '../src/spelldata/file';
import { SpellVariants } from '../src/spelldata/variants';

const FILE = parseSpellDataFile(JSON.parse(readFileSync(new URL('../data/spelldata/festergut.json', import.meta.url), 'utf8')));
const variants = new SpellVariants(FILE);
const BASE_SPELL = {
  attributes: 0, attributesEx: 0, attributesEx2: 0, attributesEx3: 0, attributesEx4: 0, attributesEx5: 0, attributesEx6: 0, attributesEx7: 0,
  schoolMask: 1, castTimeMs: null, durationMs: null, rangeYd: null, speed: 0, stackAmount: 0, maxAffectedTargets: 0,
};
const synthetic = (spells: object[]) => parseSpellDataFile({ client: 'test', files: [], spells: spells.map((s) => ({ ...BASE_SPELL, ...s })), missing: [] });

describe('difficulty variants (GetSpellIdForDifficulty)', () => {
  it('Inhaled Blight: 25n has its own id, heroic slots are empty and fall back two modes', () => {
    expect(variants.variantFor(69166, '10n')).toBe(69166);
    expect(variants.variantFor(69166, '25n')).toBe(71912);
    expect(variants.variantFor(69166, '10h')).toBe(69166);
    expect(variants.variantFor(69166, '25h')).toBe(71912);
  });

  it('Pungent Blight has four ids, and any id of the row finds the row', () => {
    expect(variants.variantFor(69195, '25h')).toBe(73032);
    expect(variants.variantFor(71219, '10n')).toBe(69195);
    expect(variants.variantFor(73031, '25n')).toBe(71219);
  });

  it('a spell without a row keeps its id; Gas Spore falls back in heroic', () => {
    expect(variants.variantFor(69165, '25n')).toBe(69165);
    expect(variants.variantFor(69278, '10h')).toBe(69278);
    expect(variants.variantFor(69278, '25h')).toBe(71221);
  });

  it('a normal slot that is empty keeps the given id', () => {
    const v = new SpellVariants(synthetic([{ id: 100, effects: [], difficultyVariants: [100, 0, 0, 0] }]));
    expect(v.variantFor(100, '25n')).toBe(100);
    expect(v.variantFor(100, '25h')).toBe(100);
  });

  it('rejects rows of the wrong length and an id in two rows', () => {
    const raw = { client: 'c', files: [], missing: [], spells: [{ id: 1, effects: [], difficultyVariants: [1, 2, 3] }] };
    expect(() => new SpellVariants(raw as never)).toThrow(/needs 4 ids/);
    expect(
      () =>
        new SpellVariants(
          synthetic([
            { id: 1, effects: [], difficultyVariants: [1, 2, 0, 0] },
            { id: 3, effects: [], difficultyVariants: [3, 2, 0, 0] },
          ]),
        ),
    ).toThrow(/spell 2 is in two difficulty rows/);
  });

  it('slots are independent: 10h set with 25h empty, and the reverse', () => {
    const v = new SpellVariants(synthetic([{ id: 10, effects: [], difficultyVariants: [10, 11, 12, 0] }, { id: 20, effects: [], difficultyVariants: [20, 21, 0, 23] }]));
    expect([v.variantFor(10, '10h'), v.variantFor(10, '25h')]).toEqual([12, 11]);
    expect([v.variantFor(20, '10h'), v.variantFor(20, '25h')]).toEqual([20, 23]);
  });

  it('the research 25n table', () => {
    const table: [number, number][] = [[69166, 71912], [69195, 71219], [69278, 71221], [69290, 71222], [69291, 72101], [69240, 71218], [69244, 71288], [72219, 72551], [72227, 72228], [69159, 70135], [69161, 70138], [69163, 70468], [72297, 72548]];
    for (const [normal, n25] of table) {
      expect(variants.variantFor(normal, '25n'), `${normal}`).toBe(n25);
      expect(variants.variantFor(n25, '25n'), `${n25}`).toBe(n25);
    }
  });

  it('ids of zero or below are returned unchanged', () => {
    const v = new SpellVariants(synthetic([{ id: 1, effects: [], difficultyVariants: [1, 2, 0, 0] }, { id: 3, effects: [], difficultyVariants: [3, 4, 0, 0] }]));
    expect(v.variantFor(0, '25n')).toBe(0);
    expect(v.variantFor(-1, '25n')).toBe(-1);
  });

  it('parse validation', () => {
    const ok = { client: 'c', files: [], spells: [], missing: [] };
    const spellOf = (extra: object) => ({ ...BASE_SPELL, id: 1, effects: [], ...extra });
    const file = (f: unknown) => ({ ...ok, files: [f] });
    const good = { name: 'Spell.dbc', sha256: 'a17bfd2d4b0ac0dbf8263371c771651e783f123329995d0ae609a08bc05a8bf7', dataVersion: 'client-12340:Spell.dbc:a17bfd2d4b0a' };
    expect(() => parseSpellDataFile({ ...ok, missing: undefined })).toThrow(/missing/);
    expect(() => parseSpellDataFile(file({ ...good, name: 1 }))).toThrow(/name, sha256 and dataVersion/);
    expect(() => parseSpellDataFile(file({ ...good, dataVersion: 'client-12340:Spell.dbc:XYZ' }))).toThrow(/dataVersion/);
    expect(() => parseSpellDataFile(file({ ...good, dataVersion: 'client-12340:Spell.dbc:000000000000' }))).toThrow(/not pinned/);
    expect(() => parseSpellDataFile(file({ ...good, archive: 3 }))).toThrow(/archive/);
    expect(parseSpellDataFile(file(good)).files).toHaveLength(1);
    for (const row of [[1, 2, 3], [1, 2, 3, -1], [1, 2, 3, 1.5], [1, 2, 3, '4'], 'abc']) {
      expect(() => parseSpellDataFile({ ...ok, spells: [{ id: 1, effects: [], difficultyVariants: row }] }), JSON.stringify(row)).toThrow(/difficultyVariants/);
    }
    expect(() => parseSpellDataFile({ ...ok, spells: [spellOf({ difficultyVariants: null })] })).not.toThrow();
  });

  it('exposes the pinned data versions by file name and refuses a file with missing spells for sourcing', () => {
    expect(spellDataVersions(FILE).get('Spell.dbc')).toBe('client-12340:Spell.dbc:a17bfd2d4b0a');
    expect(FILE.missing).toEqual([]);
    expect(() => spellDataVersions({ ...FILE, missing: [5] })).toThrow(/spells missing from the client data: 5/);
  });

  it('rejects files that are not spell data', () => {
    expect(() => parseSpellDataFile(null)).toThrow(/not a spell data file/);
    expect(() => parseSpellDataFile({ files: [], missing: [], spells: [] })).toThrow(/client/);
    expect(() => parseSpellDataFile({ client: 'c', files: [], missing: [], spells: [{ id: 'x', effects: [] }] })).toThrow(/integer id/);
    expect(() => parseSpellDataFile({ client: 'c', files: [], missing: [], spells: [{ id: 1, effects: [] }, { id: 1, effects: [] }] })).toThrow(/duplicate spell 1/);
  });
});
