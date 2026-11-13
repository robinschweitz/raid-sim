import { describe, expect, it } from 'vitest';
import { FESTERGUT_MECHANICS } from '../../src/festergut/ai';
import { newFight, ring, type TestPlayer } from './fight';

/** The AI update interval: a timer is noticed up to one update late (A-002). */
const STEP = 10;
/** No event executes while Festergut casts (spec §5.1): Inhale Blight can hold a due event back by its 3.5 s cast time. */
const CAST_HOLD = 3500;
const between = (v: number, min: number, max: number): boolean => v >= min && v <= max;

describe('Festergut script: engage and the first gas', () => {
  const f = newFight({ maxDurationMs: 12000, players: ring(12, 30) });
  f.sim.run();

  it('engages on the pulling tank and publishes the timer windows of boss_festergut.cpp 123–127', () => {
    expect(f.events('engage')[0].data).toEqual({ boss: 'festergut', who: 't1' });
    expect(f.events('timer_window').filter((e) => e.t === 0).map((e) => [e.data.ability, e.data.earliestMs, e.data.latestMs])).toEqual([
      ['berserk', 300000, 300000],
      ['inhale_blight', 25000, 30000],
      ['gas_spore', 20000, 25000],
      ['vile_gas', 30000, 40000],
      ['gastric_bloat', 12500, 15000],
    ]);
  });

  it('gets the large Gaseous Blight 6788 ms after the engage, at the next AI update (A-036)', () => {
    const applied = f.events('aura_applied', { aura: 'gaseous_blight_large', unit: 'festergut' });
    expect(applied.map((e) => e.t)).toEqual([6790]);
    expect(f.events('cast_start', { spell: 'gaseous_blight_large' })[0].data).toMatchObject({ caster: 'festergut', triggered: true });
  });

  it('the gas ticks every 2 s on every player for 4388 to 4612 shadow damage', () => {
    const ticks = f.events('damage', { ability: 'gaseous_blight_large_damage' });
    expect([...new Set(ticks.map((e) => e.t))]).toEqual([8790, 10790]);
    expect(ticks.filter((e) => e.t === 8790).map((e) => e.data.target).sort()).toEqual(ring(12, 30).map((p) => p.id).sort());
    expect(ticks.every((e) => e.data.source === 'festergut' && e.data.school === 'shadow' && between(Number(e.data.amount), 4388, 4612))).toBe(true);
  });

  it('melee: 57,517 to 79,226 on a victim without armor, one swing per 2 s', () => {
    const swings = [...f.events('damage', { ability: 'melee' }), ...f.events('melee_avoided')].sort((a, b) => a.t - b.t);
    expect(swings.map((e) => e.t)).toEqual([10, 2010, 4010, 6010, 8010, 10010]);
    expect(f.events('damage', { ability: 'melee' }).every((e) => e.data.target === 't1' && between(Number(e.data.amount), 57517, 79226))).toBe(true);
  });
});

describe('Festergut script: the inhale cycle', () => {
  const f = newFight({ maxDurationMs: 140000, players: ring(12, 30) });
  f.sim.run();
  const inhales = f.events('ai_event', { event: 'inhale_blight' });
  const first = inhales[0].t;

  it('inhales after 25 to 30 s and then every 34 s; the fourth event is Pungent Blight', () => {
    expect(between(first, 25000, 30000 + STEP)).toBe(true);
    expect(inhales.map((e) => e.t - first)).toEqual([0, 34000, 68000, 102000]);
    expect(inhales.map((e) => e.data.inhales)).toEqual([0, 1, 2, 3]);
    const casts = f.events('cast_start').filter((e) => e.data.spell === 'inhale_blight' || e.data.spell === 'pungent_blight');
    expect(casts.map((e) => [e.t - first, e.data.spell, e.data.castTimeMs])).toEqual([
      [0, 'inhale_blight', 3500],
      [34000, 'inhale_blight', 3500],
      [68000, 'inhale_blight', 3500],
      [102000, 'pungent_blight', 3000],
    ]);
  });

  it('the gas steps down without a gap: large, medium, small, none', () => {
    const gas = [...f.events('aura_applied'), ...f.events('aura_removed')]
      .filter((e) => e.data.unit === 'festergut' && String(e.data.aura).startsWith('gaseous_blight') && e.t < first + 102000)
      .sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)))
      .map((e) => [e.t === 6790 ? 'first gas' : e.t - first, e.kind, e.data.aura]);
    expect(gas).toEqual([
      ['first gas', 'aura_applied', 'gaseous_blight_large'],
      [0, 'aura_removed', 'gaseous_blight_large'],
      [0, 'aura_applied', 'gaseous_blight_medium'],
      [34000, 'aura_removed', 'gaseous_blight_medium'],
      [34000, 'aura_applied', 'gaseous_blight_small'],
      [68000, 'aura_removed', 'gaseous_blight_small'],
    ]);
    // No ambient damage between the third inhale and Pungent Blight.
    const ambient = f.sim.trace.list().filter((e) => e.kind === 'damage' && String(e.data.ability).startsWith('gaseous_blight') && e.t > first + 68000 && e.t < first + 105000);
    expect(ambient).toEqual([]);
  });

  it('each inhale gives one Inhaled Blight stack when its cast ends', () => {
    const stacks = [...f.events('aura_applied', { aura: 'inhaled_blight' }), ...f.events('aura_stack', { aura: 'inhaled_blight' })];
    expect(stacks.map((e) => [e.t - first, e.data.stacks])).toEqual([
      [3500, 1],
      [37500, 2],
      [71500, 3],
    ]);
  });

  it('three stacks: reach 8 × 1.6, swings every 1052 ms, 90 % more melee damage', () => {
    const at = first + 80000;
    const probe = newFight({ maxDurationMs: at, players: ring(12, 30) });
    probe.sim.run();
    expect(probe.boss.combatReach).toBeCloseTo(12.8, 10);
    // 2000 ms × 100 / (100 + 3 × 30) = 1052.6 → 1052 (A-031).
    const swings = [...probe.events('damage', { ability: 'melee' }), ...probe.events('melee_avoided')].filter((e) => e.t > first + 72000).map((e) => e.t);
    expect(swings[2] - swings[1]).toBe(1060);
    const hits = probe.events('damage', { ability: 'melee' }).filter((e) => e.t > first + 72000);
    expect(hits.length).toBeGreaterThan(0);
    // trunc(57,517 × 1.9) = 109,282; trunc(79,226 × 1.9) = 150,529.
    expect(hits.every((e) => between(Number(e.data.amount), 109282, 150529))).toBe(true);
  });

  it('the window of the next inhale event carries the name of what it will cast', () => {
    const names = f.events('timer_window').filter((e) => (e.data.ability === 'inhale_blight' || e.data.ability === 'pungent_blight') && e.t > 0);
    expect(names.map((e) => [e.t - first, e.data.ability, e.data.cleared === true ? 'cleared' : Number(e.data.earliestMs) - first])).toEqual([
      [0, 'inhale_blight', 34000],
      [34000, 'inhale_blight', 68000],
      [68000, 'inhale_blight', 'cleared'],
      [68000, 'pungent_blight', 102000],
      [102000, 'pungent_blight', 'cleared'],
      [102000, 'inhale_blight', 136000],
    ]);
  });
});

describe('Festergut script: Gastric Bloat, Gas Spore, Vile Gas, Berserk', () => {
  const f = newFight({ maxDurationMs: 100000, players: ring(12, 30) });
  f.sim.run();

  it('Gastric Bloat: on the victim after 12.5 to 15 s, then every 15 to 17.5 s, one stack each', () => {
    const casts = f.events('cast_start', { spell: 'gastric_bloat' });
    expect(casts.every((e) => e.data.target === 't1')).toBe(true);
    expect(between(casts[0].t, 12500, 15000 + STEP)).toBe(true);
    for (let i = 1; i < casts.length; i++) expect(between(casts[i].t - casts[i - 1].t, 15000, 17500 + CAST_HOLD + STEP), `gap ${i}`).toBe(true);
    expect(between(Number(f.events('damage', { ability: 'gastric_bloat' })[0].data.amount), 12188, 12812)).toBe(true);
    const stacks = [...f.events('aura_applied', { aura: 'gastric_bloat' }), ...f.events('aura_stack', { aura: 'gastric_bloat' })].map((e) => e.data.stacks);
    expect(stacks).toEqual(casts.map((_, i) => i + 1));
  });

  it('Gas Spore: three random players carry it for 12 s; repeats after 40 to 45 s', () => {
    const casts = f.events('cast_start', { spell: 'gas_spore' });
    expect(between(casts[0].t, 20000, 25000 + STEP)).toBe(true);
    expect(between(casts[1].t - casts[0].t, 40000, 45000 + STEP)).toBe(true);
    for (const cast of casts) {
      const carriers = f.events('aura_applied', { aura: 'gas_spore_carrier' }).filter((e) => e.t === cast.t);
      expect(carriers).toHaveLength(3);
      expect(carriers.every((e) => e.data.caster === e.data.unit && e.data.expiresMs === cast.t + 12000)).toBe(true);
    }
  });

  it('Gas Spore delays Vile Gas to 20 s after it, and the Vile Gas window follows', () => {
    const spore = f.events('cast_start', { spell: 'gas_spore' })[0].t;
    // The first Vile Gas was due after 30 to 40 s; a spore at 20 to 25 s pushes both bounds to spore + 20 s when they were earlier.
    const window = f.events('timer_window', { ability: 'vile_gas' }).find((e) => e.t === spore);
    expect(window?.data.earliestMs).toBe(Math.max(30000, spore + 20000));
    expect(window?.data.latestMs).toBe(Math.max(40000, spore + 20000));
    const vile = f.events('cast_start', { spell: 'vile_gas' })[0];
    expect(vile.t).toBeGreaterThanOrEqual(spore + 20000);
    expect(between(vile.t, Number(window?.data.earliestMs), Number(window?.data.latestMs) + STEP)).toBe(true);
  });

  it('Vile Gas prefers players at least 5 yd away when 8 of them exist', () => {
    const picks = f.events('ai_event', { event: 'vile_gas' });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((e) => e.data.farTargets === 12 && e.data.target !== 't1')).toBe(true);
  });

  it('with fewer than 8 far players it takes anyone on the threat list, the tank included', () => {
    const few = newFight({ maxDurationMs: 250000, players: ring(4, 30) });
    few.sim.run();
    const picks = few.events('ai_event', { event: 'vile_gas' });
    // Four far players until r01 becomes the victim (165.5 s): Festergut walks to r01 (A-040), which leaves three far.
    expect(picks.map((e) => e.data.farTargets)).toEqual([4, 4, 4, 3, 3]);
    expect(new Set(picks.map((e) => e.data.target)).has('t1')).toBe(true);
  });

  it('Vile Gas: an aura on everyone within 8 yd of the target, 3 ticks, each with a splash cast by the victim', () => {
    // Eight players on one spot 30 yd out: whoever is picked, all eight get the aura.
    const group: TestPlayer[] = Array.from({ length: 8 }, (_, i) => ({ id: `g${i + 1}`, dx: 30, dy: 0 }));
    const g = newFight({ maxDurationMs: 60000, players: [{ id: 't1', role: 'tank', dx: 0, dy: -9.5 }, ...group] });
    g.sim.run();
    const cast = g.events('cast_start', { spell: 'vile_gas' })[0];
    const auras = g.events('aura_applied', { aura: 'vile_gas' }).filter((e) => e.t === cast.t);
    expect(auras.map((e) => e.data.unit).sort()).toEqual(group.map((p) => p.id));
    expect(auras.every((e) => e.data.caster === 'festergut')).toBe(true);
    const ticks = g.events('periodic_tick', { aura: 'vile_gas', unit: 'g1' }).filter((e) => e.t <= cast.t + 6000);
    expect(ticks.map((e) => e.t - cast.t)).toEqual([2000, 4000, 6000]);
    const dot = g.events('damage', { ability: 'vile_gas', target: 'g1' }).filter((e) => e.t <= cast.t + 6000);
    expect(dot).toHaveLength(3);
    // 4875 to 5125, or 25 % less (from 3656) for a player who already has an Inoculated stack from the first spores.
    expect(dot.every((e) => e.data.school === 'nature+shadow' && between(Number(e.data.amount), 3656, 5125))).toBe(true);
    // The splash: cast by each victim, owned by Festergut, hits the seven others and never its caster.
    const splashCasts = g.events('cast_start', { spell: 'vile_gas_splash' }).filter((e) => e.t === cast.t + 2000);
    expect(splashCasts).toHaveLength(8);
    expect(splashCasts.every((e) => e.data.originalCaster === 'festergut' && e.data.triggered === true)).toBe(true);
    const hits = g.events('spell_hit', { spell: 'vile_gas_splash' }).filter((e) => e.t === cast.t + 2000);
    expect(hits).toHaveLength(8 * 7);
    expect(hits.every((e) => e.data.caster !== e.data.target)).toBe(true);
    const splash = g.events('damage', { ability: 'vile_gas_splash' }).filter((e) => e.t === cast.t + 2000);
    expect(splash.every((e) => e.data.source === 'festergut' && between(Number(e.data.amount), 3656, 5125))).toBe(true);
  });

  it('Berserk after 5 minutes: ten times the damage, 2.5 times the attack speed', () => {
    const b = newFight({ maxDurationMs: 303000, players: ring(12, 30) });
    b.sim.run();
    const cast = b.events('cast_start', { spell: 'berserk' })[0];
    expect(between(cast.t, 300000, 300000 + CAST_HOLD + STEP)).toBe(true);
    expect(cast.data).toMatchObject({ caster: 'festergut', triggered: true });
    expect(b.events('aura_applied', { aura: 'berserk', unit: 'festergut' })).toHaveLength(1);
    const gas = b.sim.trace.list().filter((e) => e.kind === 'damage' && String(e.data.ability).startsWith('gaseous_blight') && e.t > cast.t);
    const before = b.sim.trace.list().filter((e) => e.kind === 'damage' && e.data.ability === gas[0].data.ability && e.t < cast.t && e.data.target === gas[0].data.target);
    expect(Number(gas[0].data.amount)).toBeGreaterThan(5 * Number(before[before.length - 1].data.amount));
  });
});

describe('Festergut mechanic statuses (spec §6.1, notes for Plan 2b-2)', () => {
  it('lists every omission', () => {
    const omissions = FESTERGUT_MECHANICS.flatMap((m) => m.omissions).join('\n');
    for (const needle of [
      'hit and resist',
      'could crit',
      'missile travel time',
      '1 s root',
      'LINKED slow',
      'keeps the tick schedule',
      'gas visuals',
      'PERIODIC_DUMMY',
      'DUMMY aura of Gas Spore',
      'RemoveBlight only acts when the gas dummy exists',
      'emotes and yells are not emitted',
      'distance test is 2D here',
      'dead-player Inoculated',
      'CheckRequiredBosses',
    ]) {
      expect(omissions, needle).toContain(needle);
    }
    expect(FESTERGUT_MECHANICS.every((m) => m.validation === 'azerothcore_source' && (m.status === 'implemented') === (m.omissions.length === 0))).toBe(true);
  });

  it('pins the list of mechanics and their statuses', () => {
    expect(FESTERGUT_MECHANICS.map((m) => [m.key, m.status])).toEqual([
      ['festergut.gaseous_blight', 'partial'],
      ['festergut.inhale_blight', 'implemented'],
      ['festergut.pungent_blight', 'implemented'],
      ['festergut.gas_spore', 'partial'],
      ['festergut.inoculated', 'partial'],
      ['festergut.vile_gas', 'partial'],
      ['festergut.gastric_bloat', 'implemented'],
      ['festergut.gastric_explosion', 'partial'],
      ['festergut.melee', 'partial'],
      ['festergut.berserk', 'implemented'],
      ['festergut.emotes', 'not_implemented'],
      ['festergut.evade', 'not_implemented'],
    ]);
  });
});
