import { describe, expect, it } from 'vitest';
import { DbcFormatError, parseWdbc } from '../src/dbc/wdbc';
import { buildWdbc } from './dbc-builder';

describe('parseWdbc', () => {
  it('reads index, signed ints, floats and strings; skipped columns are null', () => {
    const file = buildWdbc('nifsx', [
      [7, -5, 1.5, 'Gas Spore', 99],
      [9, 3, 0.25, '', 0],
    ]);
    const t = parseWdbc(file, 'nifsx');
    expect(t.recordCount).toBe(2);
    expect(t.rows.get(7)).toEqual([7, -5, 1.5, 'Gas Spore', null]);
    expect(t.rows.get(9)).toEqual([9, 3, 0.25, '', null]);
  });

  it('handles byte columns', () => {
    const t = parseWdbc(buildWdbc('nbX', [[1, 200, 3]]), 'nbX');
    expect(t.rows.get(1)).toEqual([1, 200, null]);
  });

  it('rejects a wrong magic, a wrong field count, a wrong record size, truncation and duplicates', () => {
    const good = buildWdbc('ni', [[1, 2]]);
    const badMagic = good.slice();
    badMagic[0] = 0;
    expect(() => parseWdbc(badMagic, 'ni')).toThrow(DbcFormatError);
    expect(() => parseWdbc(good, 'nii')).toThrow(/format has 3 fields, file has 2/);
    expect(() => parseWdbc(good, 'nb')).toThrow(/record size/);
    expect(() => parseWdbc(good.slice(0, good.length - 2), 'ni')).toThrow(/truncated/);
    expect(() => parseWdbc(buildWdbc('ni', [[1, 2], [1, 3]]), 'ni')).toThrow(/duplicate id 1/);
    expect(() => parseWdbc(good, 'nq')).toThrow(/unknown format character q/);
    expect(() => parseWdbc(new Uint8Array(5), 'ni')).toThrow(/too short/);
  });
});
