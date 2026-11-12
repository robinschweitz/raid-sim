import { applyAura } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { newFight, type TestPlayer } from './fight';

const between = (v: number, min: number, max: number): boolean => v >= min && v <= max;

/** The tank and three players far apart; `a` gets three Inoculated stacks by hand, `b` one, `c` none. */
const PLAYERS: TestPlayer[] = [
  { id: 't1', role: 'tank', dx: 0, dy: -9.5 },
  { id: 'a', dx: 30, dy: 0 },
  { id: 'b', dx: -30, dy: 0 },
  { id: 'c', dx: 0, dy: 30 },
];

describe('Pungent Blight (boss_festergut.cpp 196–205, 275–313)', () => {
  const f = newFight({ maxDurationMs: 170000, players: PLAYERS });
  // Shortly before the cast ends (25 to 30 s + 102 s + 3 s): fresh stacks, whatever the spores did before.
  f.sim.at(125000, 0, () => {
    for (const [unit, stacks] of [['a', 3], ['b', 1]] as const) {
      const have = [...f.sim.unit(unit).auras.values()].find((x) => x.auraId === 'inoculated')?.stacks ?? 0;
      for (let i = have; i < stacks; i++) applyAura(f.sim, 'inoculated', unit, unit, []);
    }
  });
  f.sim.run();
  const cast = f.events('cast_success', { spell: 'pungent_blight' })[0];
  const hit = (unit: string) => f.events('damage', { ability: 'pungent_blight', target: unit })[0];
  const stacksAtCast = (unit: string): number => {
    const last = [...f.events('aura_applied', { aura: 'inoculated', unit }), ...f.events('aura_stack', { aura: 'inoculated', unit })].filter((e) => e.t < cast.t).sort((x, y) => x.t - y.t).pop();
    return last ? Number(last.data.stacks) : 0;
  };

  it('is cast 3 s after the fourth inhale event and hits every player', () => {
    const start = f.events('cast_start', { spell: 'pungent_blight' })[0];
    expect(cast.t - start.t).toBe(3000);
    expect(f.events('spell_hit', { spell: 'pungent_blight' }).map((e) => e.data.target).sort()).toEqual(['a', 'b', 'c', 'festergut', 't1']);
  });

  it('each Inoculated stack takes a quarter off: the stacks still count for the hit that removes them (A-024)', () => {
    expect(stacksAtCast('a')).toBe(3);
    // 48,750 to 51,250, × 0.25 with three stacks.
    expect(between(Number(hit('a').data.amount), 12187, 12812)).toBe(true);
    const b = stacksAtCast('b');
    expect(b).toBeGreaterThanOrEqual(1);
    expect(between(Number(hit('b').data.amount), Math.trunc(48750 * (1 - 0.25 * b)), Math.trunc(51250 * (1 - 0.25 * b)))).toBe(true);
    const t = stacksAtCast('t1');
    expect(between(Number(hit('t1').data.amount), Math.trunc(48750 * (1 - 0.25 * t)), Math.trunc(51250 * (1 - 0.25 * t)))).toBe(true);
    expect(hit('a').data.school).toBe('shadow');
  });

  it('removes Inoculated from every player it hits, before the damage event', () => {
    for (const unit of ['a', 'b']) {
      const removed = f.events('aura_removed', { aura: 'inoculated', unit }).find((e) => e.t === cast.t);
      expect(removed?.data.reason).toBe('removed');
      expect(Number(removed?.id.slice(1))).toBeLessThan(Number(hit(unit).id.slice(1)));
      expect([...f.sim.unit(unit).auras.values()].some((x) => x.auraId === 'inoculated' && x.appliedMs <= cast.t)).toBe(false);
    }
  });

  it('removes Inhaled Blight from Festergut and brings the large gas back', () => {
    const removed = f.events('aura_removed', { aura: 'inhaled_blight', unit: 'festergut' });
    expect(removed.map((e) => [e.t, e.data.reason])).toEqual([[cast.t, 'removed']]);
    expect(f.events('aura_applied', { aura: 'gaseous_blight_large', unit: 'festergut' }).map((e) => e.t)).toEqual([6790, cast.t]);
    // The next inhale starts the stacks again at one.
    const next = [...f.events('aura_applied', { aura: 'inhaled_blight' })].pop();
    expect(next ? [next.t > cast.t, next.data.stacks] : null).toEqual([true, 1]);
  });

  it('reschedules Gas Spore to 20 to 25 s after the event and publishes that window', () => {
    const start = f.events('cast_start', { spell: 'pungent_blight' })[0];
    const window = f.events('timer_window', { ability: 'gas_spore' }).find((e) => e.t === start.t);
    expect([Number(window?.data.earliestMs) - start.t, Number(window?.data.latestMs) - start.t]).toEqual([20000, 25000]);
    const spore = f.events('cast_start', { spell: 'gas_spore' }).find((e) => e.t > start.t);
    expect(spore && between(spore.t - start.t, 20000, 25010)).toBe(true);
  });
});
