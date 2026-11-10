import { describe, expect, it } from 'vitest';
import { centerDistance, edgeDistance, pointToEdge, positionAt, travelTimeMs } from '../src/movement';
import { EventClass, EventQueue } from '../src/queue';
import { createUnit } from '../src/units';

const base = { kind: 'player' as const, role: 'ranged' as const, maxHealth: 100, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

describe('movement', () => {
  it('interpolates halfway through a move and stops at the target (A-004)', () => {
    const u = createUnit({ ...base, id: 'p1', name: 'P1', pos: { x: 0, y: 0 } });
    const handle = new EventQueue().push(2000, EventClass.Decision, () => {});
    u.move = { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, startMs: 0, speed: 5, arrivalMs: 2000, handle };
    expect(positionAt(u, 1000)).toEqual({ x: 5, y: 0 });
    expect(positionAt(u, 2500)).toEqual({ x: 10, y: 0 });
  });

  it('measures edge distance minus both combat reaches, never negative (A-003)', () => {
    const a = createUnit({ ...base, id: 'a', name: 'A', pos: { x: 0, y: 0 } });
    const b = createUnit({ ...base, id: 'b', name: 'B', pos: { x: 10, y: 0 } });
    expect(edgeDistance(a, b, 0)).toBe(7);
    const c = createUnit({ ...base, id: 'c', name: 'C', pos: { x: 1, y: 0 } });
    expect(edgeDistance(a, c, 0)).toBe(0);
  });

  it('measures area distance from a point to a unit edge', () => {
    const b = createUnit({ ...base, id: 'b', name: 'B', pos: { x: 9.5, y: 0 } });
    expect(pointToEdge({ x: 0, y: 0 }, b, 0)).toBe(8);
  });

  it('computes travel time rounded up to the millisecond', () => {
    expect(travelTimeMs({ x: 0, y: 0 }, { x: 7, y: 0 }, 7)).toBe(1000);
    expect(travelTimeMs({ x: 0, y: 0 }, { x: 1, y: 0 }, 3)).toBe(334);
    expect(centerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('validates unit ids and sizes', () => {
    expect(() => createUnit({ ...base, id: 'Bad Id', name: 'X', pos: { x: 0, y: 0 } })).toThrow(/invalid unit id/);
    expect(() => createUnit({ ...base, id: 'x', name: 'X', maxHealth: 0, pos: { x: 0, y: 0 } })).toThrow(/maxHealth/);
  });
});
