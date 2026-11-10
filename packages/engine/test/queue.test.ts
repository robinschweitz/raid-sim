import { describe, expect, it } from 'vitest';
import { EventClass, EventQueue } from '../src/queue';

function drain(q: EventQueue): void {
  for (let e = q.pop(); e; e = q.pop()) e.run();
}

describe('EventQueue', () => {
  it('orders by time, then class, then schedule order (A-001)', () => {
    const q = new EventQueue();
    const seen: string[] = [];
    q.push(200, EventClass.SpellHit, () => seen.push('hit@200'));
    q.push(100, EventClass.Decision, () => seen.push('decision@100'));
    q.push(100, EventClass.AuraExpiry, () => seen.push('expiry@100'));
    q.push(100, EventClass.SpellHit, () => seen.push('hit1@100'));
    q.push(100, EventClass.SpellHit, () => seen.push('hit2@100'));
    q.push(100, EventClass.PeriodicTick, () => seen.push('tick@100'));
    q.push(100, EventClass.AiUpdate, () => seen.push('ai@100'));
    drain(q);
    expect(seen).toEqual(['hit1@100', 'hit2@100', 'tick@100', 'expiry@100', 'ai@100', 'decision@100', 'hit@200']);
  });

  it('skips cancelled events', () => {
    const q = new EventQueue();
    const seen: string[] = [];
    const a = q.push(10, EventClass.SpellHit, () => seen.push('a'));
    q.push(20, EventClass.SpellHit, () => seen.push('b'));
    q.cancel(a);
    expect(q.size).toBe(1);
    expect(q.peek()?.time).toBe(20);
    drain(q);
    expect(seen).toEqual(['b']);
  });

  it('rejects invalid times', () => {
    const q = new EventQueue();
    expect(() => q.push(-1, EventClass.SpellHit, () => {})).toThrow(/invalid event time/);
    expect(() => q.push(1.5, EventClass.SpellHit, () => {})).toThrow(/invalid event time/);
  });

  it('handles many events in heap order', () => {
    const q = new EventQueue();
    const times = [50, 10, 40, 30, 20, 10, 60, 0];
    const seen: number[] = [];
    for (const t of times) q.push(t, EventClass.SpellHit, () => seen.push(t));
    drain(q);
    expect(seen).toEqual([0, 10, 10, 20, 30, 40, 50, 60]);
  });
});
