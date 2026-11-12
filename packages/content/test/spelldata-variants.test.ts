import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpellDataFile } from '../src/spelldata/file';
import { SpellVariants } from '../src/spelldata/variants';

const FILE = parseSpellDataFile(JSON.parse(readFileSync(new URL('../data/spelldata/festergut.json', import.meta.url), 'utf8')));
const variants = new SpellVariants(FILE);
const synthetic = (spells: unknown[]) => parseSpellDataFile({ client: 'test', files: [], spells });

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
    expect(() => new SpellVariants(synthetic([{ id: 1, effects: [], difficultyVariants: [1, 2, 3] }]))).toThrow(/needs 4 ids/);
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

  it('rejects files that are not spell data', () => {
    expect(() => parseSpellDataFile(null)).toThrow(/not a spell data file/);
    expect(() => parseSpellDataFile({ files: [], spells: [{ id: 'x', effects: [] }] })).toThrow(/integer id/);
    expect(() => parseSpellDataFile({ files: [], spells: [{ id: 1, effects: [] }, { id: 1, effects: [] }] })).toThrow(/duplicate spell 1/);
  });
});
