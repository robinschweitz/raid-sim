import { applyAura } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { DATA_INOCULATED_STACK } from '../../src/festergut/ai';
import { newFight, ring, type TestPlayer } from './fight';

const between = (v: number, min: number, max: number): boolean => v >= min && v <= max;

/** The tank and ten players on one spot 30 yd from Festergut: every spore explodes on all ten. */
const GROUP: TestPlayer[] = [{ id: 't1', role: 'tank', dx: 0, dy: -9.5 }, ...Array.from({ length: 10 }, (_, i) => ({ id: `g${String(i + 1).padStart(2, '0')}`, dx: 30, dy: 0 }))];
const GROUP_IDS = GROUP.slice(1).map((p) => p.id);

describe('Gas Spore explosion → Blighted Spores → Inoculated (research §3)', () => {
  const f = newFight({ maxDurationMs: 122000, players: GROUP });
  f.sim.run();
  const spore = f.events('cast_start', { spell: 'gas_spore' })[0].t;
  const carriers = f.events('aura_applied', { aura: 'gas_spore_carrier' }).filter((e) => e.t === spore).map((e) => String(e.data.unit));

  it('each carrier casts Blighted Spores when its 12 s are over; players within 8 yd get the aura, the carrier included', () => {
    const casts = f.events('cast_start', { spell: 'blighted_spores' }).filter((e) => e.t === spore + 12000);
    expect(casts.map((e) => e.data.caster).sort()).toEqual([...carriers].sort());
    expect(casts.every((e) => e.data.triggered === true && e.data.originalCaster === undefined)).toBe(true);
    const groupCarriers = carriers.filter((c) => c !== 't1');
    expect(groupCarriers.length).toBeGreaterThan(0);
    const holders = new Set(f.events('aura_applied', { aura: 'blighted_spores' }).filter((e) => e.t === spore + 12000).map((e) => e.data.unit));
    for (const id of GROUP_IDS) expect(holders.has(id), id).toBe(true);
    // The tank stands 31 yd from the group: only its own spore reaches it.
    expect(holders.has('t1')).toBe(carriers.includes('t1'));
  });

  it('copies of different carriers replace each other, so one aura ticks: 6 ticks of 2925 to 3075', () => {
    const ticks = f.events('damage', { ability: 'blighted_spores', target: 'g01' }).filter((e) => e.t <= spore + 18000);
    expect(ticks.map((e) => e.t - spore)).toEqual([13000, 14000, 15000, 16000, 17000, 18000]);
    expect(ticks.every((e) => e.data.school === 'shadow' && between(Number(e.data.amount), 2925, 3075))).toBe(true);
    const replaced = f.events('aura_removed', { aura: 'blighted_spores', unit: 'g01' }).filter((e) => e.t === spore + 12000);
    expect(replaced.every((e) => e.data.reason === 'replaced')).toBe(true);
  });

  it('when Blighted Spores ends, the player casts Inoculated on itself: one stack per round, whatever the number of spores', () => {
    const gained = f.events('aura_applied', { aura: 'inoculated' }).filter((e) => e.t <= spore + 18000);
    expect(gained.every((e) => e.t === spore + 18000 && e.data.caster === e.data.unit && e.data.expiresMs === spore + 138000)).toBe(true);
    expect(gained.map((e) => e.data.unit).filter((u) => u !== 't1').sort()).toEqual(GROUP_IDS);
    const cast = f.events('cast_start', { spell: 'inoculated', caster: 'g01' })[0];
    expect(cast.data).toMatchObject({ target: 'g01', triggered: true });
    expect(cast.data.originalCaster).toBeUndefined();
  });

  it('three rounds give three stacks, and Festergut records the highest stack', () => {
    const stacks = [...f.events('aura_applied', { aura: 'inoculated', unit: 'g01' }), ...f.events('aura_stack', { aura: 'inoculated', unit: 'g01' })].map((e) => e.data.stacks);
    expect(stacks).toEqual([1, 2, 3]);
    expect(f.ai.getData(DATA_INOCULATED_STACK)).toBe(3);
    // Later ticks are reduced by the stacks the player already has (25 % each).
    const late = f.events('damage', { ability: 'blighted_spores', target: 'g01' }).pop();
    expect(between(Number(late?.data.amount), Math.trunc(2925 * 0.5), Math.trunc(3075 * 0.5))).toBe(true);
  });

  it('a carrier standing alone inoculates only itself', () => {
    const lone = newFight({ maxDurationMs: 45000, players: ring(12, 30) });
    lone.sim.run();
    const who = lone.events('aura_applied', { aura: 'gas_spore_carrier' }).map((e) => e.data.unit).sort();
    expect(lone.events('aura_applied', { aura: 'inoculated' }).map((e) => e.data.unit).sort()).toEqual(who);
    expect(lone.ai.getData(DATA_INOCULATED_STACK)).toBe(1);
  });
});

describe('Blighted Spores: deaths and the two time rules (boss_festergut.cpp 324–341, research §8)', () => {
  it('a carrier that dies before 12 s does not explode', () => {
    const f = newFight({ maxDurationMs: 40000, players: GROUP });
    let victim: string | null = null;
    f.sim.subscribe((e) => {
      if (e.kind !== 'aura_applied' || e.data.aura !== 'gas_spore_carrier' || victim !== null) return;
      victim = String(e.data.unit);
      f.sim.at(f.sim.now + 1000, 0, () => void f.sim.damage(victim!, 1e9, { sourceId: 'festergut', ability: 'test_kill', school: 'physical' }, []));
    });
    f.sim.run();
    expect(victim).not.toBeNull();
    expect(f.events('aura_removed', { aura: 'gas_spore_carrier', unit: victim }).map((e) => e.data.reason)).toEqual(['death']);
    expect(f.events('cast_start', { spell: 'blighted_spores', caster: victim })).toEqual([]);
  });

  it('a player who dies with Blighted Spores still gains Inoculated, and keeps it', () => {
    const f = newFight({ maxDurationMs: 40000, players: GROUP });
    let killed = false;
    f.sim.subscribe((e) => {
      if (e.kind !== 'aura_applied' || e.data.aura !== 'blighted_spores' || e.data.unit !== 'g02' || killed) return;
      killed = true;
      f.sim.at(f.sim.now + 2500, 0, () => void f.sim.damage('g02', 1e9, { sourceId: 'festergut', ability: 'test_kill', school: 'physical' }, []));
    });
    f.sim.run();
    const death = f.events('death', { unit: 'g02' })[0];
    const gained = f.events('aura_applied', { aura: 'inoculated', unit: 'g02' });
    expect(gained.map((e) => e.t)).toEqual([death.t]);
    expect(f.sim.unit('g02').alive).toBe(false);
    expect([...f.sim.unit('g02').auras.values()].map((x) => x.auraId)).toEqual(['inoculated']);
  });

  it('1 s rule: an aura replaced right after it landed gives nothing; 10 s rule: at most one stack per 10 s', () => {
    // Before the first Gas Spore (20 s at the earliest), by hand, on players far apart.
    const f = newFight({ maxDurationMs: 19000, players: ring(4, 30) });
    const spores = (caster: string, target: string) => () => void applyAura(f.sim, 'blighted_spores', caster, target, []);
    f.sim.at(1000, 0, spores('r01', 'r02')); // replaced at once by r03's copy: no stack
    f.sim.at(1000, 0, spores('r03', 'r02')); // ends at 7 s: stack 1
    f.sim.at(8000, 0, spores('r03', 'r02')); // ends at 14 s, 7 s after the last stack: nothing
    f.sim.at(11500, 0, spores('r03', 'r02')); // refreshes it to 17.5 s, 10.5 s after the last stack: stack 2
    f.sim.run();
    const gains = [...f.events('aura_applied', { aura: 'inoculated', unit: 'r02' }), ...f.events('aura_stack', { aura: 'inoculated', unit: 'r02' })];
    expect(gains.map((e) => [e.t, e.data.stacks])).toEqual([
      [7000, 1],
      [17500, 2],
    ]);
    expect(f.events('aura_removed', { aura: 'blighted_spores', unit: 'r02' }).map((e) => [e.t, e.data.reason])).toEqual([
      [1000, 'replaced'],
      [7000, 'expired'],
      [17500, 'expired'],
    ]);
    expect(f.ai.getData(DATA_INOCULATED_STACK)).toBe(2);
  });
});
