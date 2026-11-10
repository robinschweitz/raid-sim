import { describe, expect, it } from 'vitest';
import { TraceWriter, canonicalStringify } from '../src/trace';

describe('TraceWriter', () => {
  it('assigns sequential stable ids and keeps causes', () => {
    const w = new TraceWriter();
    const a = w.emit(0, 'engage', { boss: 'b' });
    const b = w.emit(10, 'ai_event', { boss: 'b', event: 'x' }, [a.id]);
    expect([a.id, b.id]).toEqual(['e1', 'e2']);
    expect(w.get('e2')?.causes).toEqual(['e1']);
  });

  it('rejects unknown causes', () => {
    const w = new TraceWriter();
    expect(() => w.emit(0, 'engage', {}, ['e9'])).toThrow(/unknown cause e9/);
  });

  it('copies data so later changes do not leak in', () => {
    const w = new TraceWriter();
    const data: Record<string, number> = { amount: 1 };
    const ev = w.emit(0, 'damage', data);
    data.amount = 2;
    expect(ev.data.amount).toBe(1);
  });

  it('copies array values in data', () => {
    const w = new TraceWriter();
    const arr = ['a', 'b'];
    const ev = w.emit(0, 'damage', { picked: arr });
    arr.push('x');
    expect(ev.data.picked).toEqual(['a', 'b']);
  });

  it('rejects invalid times and unknown kinds', () => {
    const w = new TraceWriter();
    expect(() => w.emit(-1, 'engage', {})).toThrow(/invalid trace time/);
    expect(() => w.emit(Number.NaN, 'engage', {})).toThrow(/invalid trace time/);
    expect(() => w.emit(0, 'bogus' as never, {})).toThrow(/unknown event kind/);
  });

  it('a failed emit does not consume an id', () => {
    const w = new TraceWriter();
    expect(() => w.emit(-1, 'engage', {})).toThrow();
    expect(w.emit(0, 'engage', {}).id).toBe('e1');
  });
});

describe('canonicalStringify', () => {
  it('sorts object keys at every level and keeps array order', () => {
    expect(canonicalStringify({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });

  it('rejects non-finite numbers and functions', () => {
    expect(() => canonicalStringify({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalStringify({ a: () => 1 })).toThrow(/cannot serialise/);
  });

  it('rejects sparse arrays and non-plain objects', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(() => canonicalStringify([1, , 3])).toThrow();
    expect(() => canonicalStringify({ a: new Map() })).toThrow(/cannot serialise/);
    expect(() => canonicalStringify({ a: new Date(0) })).toThrow(/cannot serialise/);
  });

  it('drops undefined object members', () => {
    expect(canonicalStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});
