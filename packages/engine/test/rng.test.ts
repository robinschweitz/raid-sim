import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../src/rng';

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('RngRegistry', () => {
  it('is deterministic per seed and stream name', () => {
    const a = new RngRegistry(42).stream('boss:festergut.gas_spore');
    const b = new RngRegistry(42).stream('boss:festergut.gas_spore');
    expect([a.nextU32(), a.nextU32(), a.nextU32()]).toEqual([b.nextU32(), b.nextU32(), b.nextU32()]);
  });

  it('gives different sequences to different names and seeds', () => {
    const base = new RngRegistry(42).stream('x').nextU32();
    expect(new RngRegistry(42).stream('y').nextU32()).not.toBe(base);
    expect(new RngRegistry(43).stream('x').nextU32()).not.toBe(base);
  });

  it('keeps streams independent', () => {
    const clean = new RngRegistry(7);
    const busy = new RngRegistry(7);
    for (let i = 0; i < 100; i++) busy.stream('unit:p1.amount').nextU32();
    expect(busy.stream('boss:b.targets').nextU32()).toBe(clean.stream('boss:b.targets').nextU32());
  });

  it('int is inclusive on both ends and validates the range', () => {
    const r = new RngRegistry(1).stream('t');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
    expect(() => r.int(3, 1)).toThrow(/invalid range/);
    expect(() => r.int(0.5, 1)).toThrow(/invalid range/);
  });

  it('pick depends on the set of ids, not their order', () => {
    const items = [{ id: 'c' }, { id: 'a' }, { id: 'd' }, { id: 'b' }];
    const p1 = new RngRegistry(9).stream('pick').pick(items, 2);
    const p2 = new RngRegistry(9).stream('pick').pick([...items].reverse(), 2);
    expect(ids(p1)).toEqual(ids(p2));
    expect(p1).toHaveLength(2);
  });

  it('pick returns every item when n exceeds the pool', () => {
    const r = new RngRegistry(9).stream('pick');
    expect(ids(r.pick([{ id: 'a' }, { id: 'b' }], 5)).sort()).toEqual(['a', 'b']);
  });

  it('rejects invalid stream names and seeds', () => {
    expect(() => new RngRegistry(1).stream('Bad Name')).toThrow(/invalid stream name/);
    expect(() => new RngRegistry(1.5)).toThrow(/seed/);
  });

  it('counts draws per stream', () => {
    const reg = new RngRegistry(1);
    reg.stream('b').nextU32();
    reg.stream('a').int(1, 2);
    expect(reg.usage()).toEqual({ a: 1, b: 1 });
  });
});
