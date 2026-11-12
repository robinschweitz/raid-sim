import { damageDoneFactor } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { newFight, type TestPlayer } from './fight';

const between = (v: number, min: number, max: number): boolean => v >= min && v <= max;

/** The tank, a melee player 6 yd from the tank, one 10.5 yd from the tank, and a ranged player far away. */
const PLAYERS: TestPlayer[] = [
  { id: 't1', role: 'tank', dx: 0, dy: -9.5 },
  { id: 'near', role: 'melee', dx: 6, dy: -9.5 },
  { id: 'edge', role: 'melee', dx: 10.5, dy: -9.5 },
  { id: 'far', dx: 0, dy: -40 },
];

describe('Gastric Bloat at ten stacks: Gastric Explosion (boss_festergut.cpp 349–372, research §7)', () => {
  const f = newFight({ maxDurationMs: 200000, players: PLAYERS });
  let factorAtFive = 0;
  f.sim.subscribe((e) => {
    if (e.kind === 'aura_stack' && e.data.aura === 'gastric_bloat' && e.data.stacks === 5) factorAtFive = damageDoneFactor(f.sim, 't1', 'fire');
  });
  f.sim.run();
  const explosion = f.events('cast_start', { spell: 'gastric_explosion' })[0];

  it('each stack raises the damage of the tank by 10 %', () => {
    expect(factorAtFive).toBeCloseTo(1.5, 10);
  });

  it('the tenth stack removes the aura and makes the tank cast Gastric Explosion on itself', () => {
    const stacks = [...f.events('aura_applied', { aura: 'gastric_bloat' }), ...f.events('aura_stack', { aura: 'gastric_bloat' })].filter((e) => e.t <= explosion.t);
    expect(stacks.map((e) => e.data.stacks)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stacks.every((e) => e.data.unit === 't1')).toBe(true);
    const tenth = stacks[9];
    expect(explosion.t).toBe(tenth.t);
    expect(explosion.data).toMatchObject({ caster: 't1', target: 't1', triggered: true });
    // No original caster: the tank owns the damage (A-020).
    expect(explosion.data.originalCaster).toBeUndefined();
    const removed = f.events('aura_removed', { aura: 'gastric_bloat', unit: 't1' }).find((e) => e.t === explosion.t);
    expect(removed?.data.reason).toBe('removed');
    expect(Number(removed?.id.slice(1))).toBeLessThan(Number(explosion.id.slice(1)));
    // Both come from the Gastric Bloat hit that also added the tenth stack.
    expect(explosion.causes).toEqual(tenth.causes);
  });

  it('hits players within 10 yd of the tank for 29,250 to 30,750, less 25 % per Inoculated stack', () => {
    const hits = f.events('damage', { ability: 'gastric_explosion' }).filter((e) => e.data.target !== 't1');
    expect(hits.map((e) => e.data.target)).toEqual(['near']);
    // The Inoculated stacks of `near` at that moment, read from the trace.
    let stacks = 0;
    for (const e of f.sim.trace.list()) {
      if (e.t > explosion.t) break;
      if (e.data.aura !== 'inoculated' || e.data.unit !== 'near') continue;
      stacks = e.kind === 'aura_removed' ? 0 : Number(e.data.stacks);
    }
    const factor = 1 - 0.25 * stacks;
    expect(hits[0].data).toMatchObject({ source: 't1', school: 'nature+shadow' });
    expect(between(Number(hits[0].data.amount), Math.trunc(29250 * factor), Math.trunc(30750 * factor))).toBe(true);
  });

  it('kills the tank, and Gastric Bloat goes on with the next victim', () => {
    const death = f.events('death', { unit: 't1' })[0];
    expect(death.t).toBe(explosion.t);
    const blow = f.sim.trace.get(death.causes[0]);
    expect(blow?.data).toMatchObject({ ability: 'gastric_explosion', source: 't1', target: 't1' });
    const next = f.events('cast_start', { spell: 'gastric_bloat' }).find((e) => e.t > explosion.t);
    expect(next && next.data.target !== 't1').toBe(true);
  });
});
