import { describe, expect, it } from 'vitest';
import { meleeRange, withinMeleeRange } from '../src/movement';
import { createUnit } from '../src/units';

const base = { kind: 'player' as const, role: 'tank' as const, maxHealth: 1000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

describe('combat fields', () => {
  it('defaults level 80, no armor, no avoidance, no melee, threat multiplier 1', () => {
    const u = createUnit({ ...base, id: 'p1', name: 'P1', pos: { x: 0, y: 0 } });
    expect(u).toMatchObject({ level: 80, armor: 0, avoidance: { missPct: 0, dodgePct: 0, parryPct: 0 }, melee: null, threatMultiplier: 1, nextSwingMs: 0 });
  });

  it('validates combat fields', () => {
    const mk = (extra: object) => () => createUnit({ ...base, id: 'p1', name: 'P1', pos: { x: 0, y: 0 }, ...extra });
    expect(mk({ level: 0 })).toThrow(/level/);
    expect(mk({ armor: -1 })).toThrow(/armor/);
    expect(mk({ avoidance: { missPct: 60, dodgePct: 30, parryPct: 20 } })).toThrow(/avoidance/);
    expect(mk({ melee: { minDamage: 10, maxDamage: 5, attackTimeMs: 2000 } })).toThrow(/melee/);
    expect(mk({ melee: { minDamage: 1, maxDamage: 5, attackTimeMs: 0 } })).toThrow(/melee/);
    expect(mk({ threatMultiplier: Number.NaN })).toThrow(/threat multiplier/);
    expect(mk({ melee: { minDamage: 1, maxDamage: Infinity, attackTimeMs: 2000 } })).toThrow(/melee/);
  });

  it('stores valid non-default values', () => {
    const u = createUnit({
      ...base, id: 'p1', name: 'P1', pos: { x: 0, y: 0 },
      level: 83, armor: 100, avoidance: { missPct: 5, dodgePct: 10, parryPct: 15 },
      melee: { minDamage: 1, maxDamage: 2, attackTimeMs: 2000 }, threatMultiplier: 2,
    });
    expect(u).toMatchObject({
      level: 83, armor: 100, avoidance: { missPct: 5, dodgePct: 10, parryPct: 15 },
      melee: { minDamage: 1, maxDamage: 2, attackTimeMs: 2000 }, threatMultiplier: 2,
    });
  });

  it('accepts avoidance totalling exactly 100', () => {
    const u = createUnit({ ...base, id: 'p1', name: 'P1', pos: { x: 0, y: 0 }, avoidance: { missPct: 50, dodgePct: 30, parryPct: 20 } });
    expect(u.avoidance.missPct + u.avoidance.dodgePct + u.avoidance.parryPct).toBe(100);
  });

  it('stores copies of avoidance and melee', () => {
    const avoidance = { missPct: 5, dodgePct: 10, parryPct: 15 };
    const melee = { minDamage: 1, maxDamage: 2, attackTimeMs: 2000 };
    const u = createUnit({ ...base, id: 'p1', name: 'P1', pos: { x: 0, y: 0 }, avoidance, melee });
    avoidance.missPct = 99;
    melee.maxDamage = 99;
    expect(u.avoidance.missPct).toBe(5);
    expect(u.melee?.maxDamage).toBe(2);
  });
});

describe('melee range (Unit::GetMeleeRange)', () => {
  const boss = createUnit({ ...base, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', combatReach: 8, pos: { x: 0, y: 0 } });
  const tank = createUnit({ ...base, id: 't1', name: 'T1', pos: { x: 10.8, y: 0 } });
  const far = createUnit({ ...base, id: 't2', name: 'T2', pos: { x: 10.9, y: 0 } });
  const p1 = createUnit({ ...base, id: 'p1', name: 'P1', pos: { x: 0, y: 0 } });
  const p2 = createUnit({ ...base, id: 'p2', name: 'P2', pos: { x: 0, y: 0 } });

  it('is both reaches plus 4/3, at least 5 yd, centre to centre', () => {
    expect(meleeRange(boss, tank)).toBeCloseTo(8 + 1.5 + 4 / 3, 10);
    expect(meleeRange(p1, p2)).toBe(5);
    expect(withinMeleeRange(boss, tank, 0)).toBe(true);
    expect(withinMeleeRange(boss, far, 0)).toBe(false);
  });
});
