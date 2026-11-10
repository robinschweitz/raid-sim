import { describe, expect, it } from 'vitest';
import { EventMap } from '../src/eventmap';
import { RngRegistry } from '../src/rng';

const newMap = () => new EventMap(new RngRegistry(1).stream('test.timers'));

function drainDue(m: EventMap): number[] {
  const out: number[] = [];
  for (let id = m.execute(); id !== 0; id = m.execute()) out.push(id);
  return out;
}

describe('EventMap', () => {
  it('executes an event only once it is due', () => {
    const m = newMap();
    m.schedule(1, 1000);
    m.update(999);
    expect(m.execute()).toBe(0);
    m.update(1);
    expect(m.execute()).toBe(1);
    expect(m.execute()).toBe(0);
  });

  it('returns one due event per call, earliest first, insertion order for ties', () => {
    const m = newMap();
    m.schedule(3, 500);
    m.schedule(1, 100);
    m.schedule(2, 100);
    m.update(1000);
    expect(m.execute()).toBe(1);
    expect(m.execute()).toBe(2);
    expect(m.execute()).toBe(3);
  });

  it('scheduleRange draws an inclusive delay from its stream', () => {
    const expected = new RngRegistry(1).stream('test.timers').int(20000, 25000);
    const m = newMap();
    m.scheduleRange(7, 20000, 25000);
    m.update(expected - 1);
    expect(m.execute()).toBe(0);
    m.update(1);
    expect(m.execute()).toBe(7);
  });

  it('reschedule cancels earlier copies', () => {
    const m = newMap();
    m.schedule(1, 100);
    m.schedule(1, 200);
    m.reschedule(1, 300);
    m.update(250);
    expect(m.execute()).toBe(0);
    m.update(50);
    expect(drainDue(m)).toEqual([1]);
  });

  it('discards due events of another phase, keeps phaseless ones', () => {
    const m = newMap();
    m.schedule(1, 100, 0, 2);
    m.schedule(2, 100, 0, 0);
    m.setPhase(1);
    m.update(100);
    expect(drainDue(m)).toEqual([2]);
    expect(m.isEmpty()).toBe(true);
  });

  it('delayEventsToMax moves only matching events due before now+delay', () => {
    const m = newMap();
    m.schedule(1, 5000, 1); // group 1, early: moved
    m.schedule(2, 30000, 1); // group 1, late: untouched
    m.schedule(3, 5000, 2); // group 2: untouched
    m.delayEventsToMax(20000, 1);
    m.update(5000);
    expect(drainDue(m)).toEqual([3]);
    m.update(15000);
    expect(drainDue(m)).toEqual([1]);
    m.update(10000);
    expect(drainDue(m)).toEqual([2]);
  });

  it('delayEventsToMax drops the moved event phase, like AzerothCore', () => {
    const m = newMap();
    m.schedule(1, 100, 1, 2);
    m.delayEventsToMax(1000, 1);
    m.setPhase(1);
    m.update(1000);
    expect(m.execute()).toBe(1);
  });

  it('cancelGroup removes only that group', () => {
    const m = newMap();
    m.schedule(1, 100, 1);
    m.schedule(2, 100, 2);
    m.cancelGroup(1);
    m.update(100);
    expect(drainDue(m)).toEqual([2]);
  });

  it('delayEvents shifts every event or one group', () => {
    const m = newMap();
    m.schedule(1, 100, 1);
    m.schedule(2, 100, 2);
    m.delayEvents(50, 1);
    m.update(100);
    expect(drainDue(m)).toEqual([2]);
    m.update(50);
    expect(drainDue(m)).toEqual([1]);
  });

  it('repeat reschedules the last executed event', () => {
    const m = newMap();
    m.schedule(4, 100);
    m.update(100);
    expect(m.execute()).toBe(4);
    m.repeat(200);
    m.update(200);
    expect(m.execute()).toBe(4);
    expect(() => newMap().repeat(1)).toThrow(/before any event/);
  });
});
