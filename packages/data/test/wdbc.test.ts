import { describe, expect, it } from 'vitest';
import { DbcFormatError, parseWdbc } from '../src/dbc/wdbc';
import { buildWdbc } from './dbc-builder';

/** Builds a file whose string block is exactly `block` (raw bytes), for one record 'ns' pointing at `offset`. */
function withRawStrings(block: number[], offset: number): Uint8Array {
  const base = buildWdbc('ns', [[1, '']]);
  const out = new Uint8Array(20 + 8 + block.length);
  out.set(base.subarray(0, 28), 0);
  new DataView(out.buffer).setUint32(16, block.length, true);
  new DataView(out.buffer).setUint32(24, offset, true);
  out.set(block, 28);
  return out;
}

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

  it('skips the d column as null', () => {
    const t = parseWdbc(buildWdbc('ndi', [[1, 5, 6]]), 'ndi');
    expect(t.rows.get(1)).toEqual([1, null, 6]);
  });

  it('reads an index above 2^31 as unsigned', () => {
    const t = parseWdbc(buildWdbc('ni', [[4000000000, 1]]), 'ni');
    expect(t.rows.get(4000000000)).toEqual([4000000000, 1]);
  });

  it('reads negative floats', () => {
    const t = parseWdbc(buildWdbc('nf', [[1, -2.5]]), 'nf');
    expect(t.rows.get(1)).toEqual([1, -2.5]);
  });

  it('decodes multi-byte UTF-8 strings', () => {
    const t = parseWdbc(buildWdbc('ns', [[1, 'Größe 日本 \u{1F600}']]), 'ns');
    expect(t.rows.get(1)).toEqual([1, 'Größe 日本 \u{1F600}']);
  });

  it('parses a subarray with a non-zero byteOffset', () => {
    const file = buildWdbc('nis', [[3, -1, 'x']]);
    const padded = new Uint8Array(file.length + 7);
    padded.set(file, 3);
    const t = parseWdbc(padded.subarray(3, 3 + file.length), 'nis');
    expect(t.rows.get(3)).toEqual([3, -1, 'x']);
  });

  it('rejects a wrong magic', () => {
    const bad = buildWdbc('ni', [[1, 2]]).slice();
    bad[0] = 0;
    expect(() => parseWdbc(bad, 'ni')).toThrow(DbcFormatError);
  });

  it('rejects a wrong field count', () => {
    expect(() => parseWdbc(buildWdbc('ni', [[1, 2]]), 'nii')).toThrow(/format has 3 fields, file has 2/);
  });

  it('rejects a wrong record size', () => {
    expect(() => parseWdbc(buildWdbc('ni', [[1, 2]]), 'nb')).toThrow(/record size/);
  });

  it('rejects truncation', () => {
    const good = buildWdbc('ni', [[1, 2]]);
    expect(() => parseWdbc(good.slice(0, good.length - 2), 'ni')).toThrow(/truncated/);
  });

  it('rejects trailing bytes after the string block', () => {
    const good = buildWdbc('ni', [[1, 2]]);
    const longer = new Uint8Array(good.length + 3);
    longer.set(good);
    expect(() => parseWdbc(longer, 'ni')).toThrow('file has 3 unexpected trailing bytes');
  });

  it('rejects duplicate ids', () => {
    expect(() => parseWdbc(buildWdbc('ni', [[1, 2], [1, 3]]), 'ni')).toThrow(/duplicate id 1/);
  });

  it('rejects an unknown format character', () => {
    expect(() => parseWdbc(buildWdbc('ni', [[1, 2]]), 'nq')).toThrow(/unknown format character q/);
  });

  it('rejects a file too short for a header', () => {
    expect(() => parseWdbc(new Uint8Array(5), 'ni')).toThrow(/too short/);
  });

  it('rejects a format with no index column', () => {
    expect(() => parseWdbc(buildWdbc('ii', [[1, 2]]), 'ii')).toThrow(/no index column/);
  });

  it('rejects a format with more than one index column', () => {
    expect(() => parseWdbc(buildWdbc('nn', [[1, 2]]), 'nn')).toThrow('format has more than one index column (n)');
  });

  it('rejects an unterminated string', () => {
    const file = withRawStrings([0, 0x41, 0x42], 1);
    expect(() => parseWdbc(file, 'ns')).toThrow('unterminated string at offset 1');
  });

  it('rejects invalid UTF-8 in a string', () => {
    const file = withRawStrings([0, 0xff, 0xfe, 0], 1);
    expect(() => parseWdbc(file, 'ns')).toThrow('invalid UTF-8 in string at offset 1');
  });

  it('yields null for invalid UTF-8 in a column the predicate marks non-strict', () => {
    const file = withRawStrings([0, 0xff, 0xfe, 0], 1);
    expect(parseWdbc(file, 'ns', { strictStringColumns: () => false }).rows.get(1)).toEqual([1, null]);
    expect(() => parseWdbc(file, 'ns', { strictStringColumns: (c) => c === 1 })).toThrow('invalid UTF-8');
    expect(parseWdbc(file, 'ns', { strictStringColumns: (c) => c !== 1 }).rows.get(1)).toEqual([1, null]);
  });

  it('still rejects structural string errors in a non-strict column', () => {
    expect(() => parseWdbc(withRawStrings([0], 5), 'ns', { strictStringColumns: () => false })).toThrow(/outside the string block/);
  });

  it('rejects a string offset outside the string block', () => {
    const file = withRawStrings([0], 5);
    expect(() => parseWdbc(file, 'ns')).toThrow(/outside the string block/);
  });
});
