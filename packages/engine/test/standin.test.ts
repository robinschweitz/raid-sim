import { describe, expect, it } from 'vitest';
import { StandinMemberSchema } from '../src/plan/schema';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { installStandin } from '../src/standin';

const standin = (id: string, role: 'tank' | 'healer' | 'ranged', ratePerSecond: number) =>
  StandinMemberSchema.parse({ id, name: id, kind: 'standin', role, maxHealth: 40000, ratePerSecond, reaction: { minMs: 300, maxMs: 300 } });

function newSim() {
  const sim = new Simulation({ seed: 6, maxDurationMs: 3500, sampleIntervalMs: 1000 });
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1000000, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 5, boundingRadius: 2 });
  const place = { t1: { x: 6, y: 0 }, h1: { x: 0, y: 20 }, d1: { x: 0, y: -20 }, d2: { x: 0, y: -50 } } as const;
  const members = [standin('t1', 'tank', 500), standin('h1', 'healer', 800), standin('d1', 'ranged', 1000), standin('d2', 'ranged', 1000)];
  for (const m of members) {
    sim.addUnit({ id: m.id, name: m.id, kind: 'player', role: m.role, approximate: true, maxHealth: m.maxHealth, pos: place[m.id as keyof typeof place], speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
    installStandin(sim, m);
  }
  return sim;
}

const of = (sim: Simulation, kind: string) => sim.trace.list().filter((e) => e.kind === kind);

describe('stand-ins (§6.3)', () => {
  it('damage in range once per second, nothing out of range or while moving', () => {
    const sim = newSim();
    sim.at(1500, EventClass.Decision, () => void sim.startMove('d1', { x: 0, y: -30 }, []));
    sim.run();
    const bySource = (id: string) => of(sim, 'damage').filter((e) => e.data.source === id).map((e) => e.t);
    expect(bySource('t1')).toEqual([1000, 2000, 3000]);
    expect(bySource('d1')).toEqual([1000, 3000]);
    expect(bySource('d2')).toEqual([]);
    expect(of(sim, 'damage')[0].data).toMatchObject({ ability: 'standin_damage', amount: 500 });
  });

  it('a healer heals the lowest injured player in range', () => {
    const sim = newSim();
    sim.at(500, EventClass.SpellHit, () => void sim.damage('t1', 2000, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    sim.at(500, EventClass.SpellHit, () => void sim.damage('d2', 9000, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    sim.run();
    const heals = of(sim, 'heal').map((e) => [e.t, e.data.target, e.data.amount]);
    // d2 is lower but 70 yd away (out of the 40 yd range), so t1 is healed.
    expect(heals[0]).toEqual([1000, 't1', 800]);
  });

  it('a healer picks the lowest health percentage, not the lowest absolute health; ties go to the lowest id', () => {
    const sim = newSim();
    sim.addUnit({ id: 'small', name: 'small', kind: 'player', role: 'ranged', maxHealth: 5000, pos: { x: 0, y: 25 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
    const hit = (id: string, n: number) => sim.at(500, EventClass.SpellHit, () => void sim.damage(id, n, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    // small: 3000 of 5000 left (60%, lowest absolute health); t1: 20000 of 40000 left (50%, lowest percentage).
    hit('small', 2000);
    hit('t1', 20000);
    sim.run();
    expect(of(sim, 'heal')[0].data).toMatchObject({ target: 't1' });

    const tie = newSim();
    tie.addUnit({ id: 'a_pal', name: 'a_pal', kind: 'player', role: 'ranged', maxHealth: 40000, pos: { x: 0, y: 25 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
    for (const id of ['t1', 'a_pal']) tie.at(500, EventClass.SpellHit, () => void tie.damage(id, 4000, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    tie.run();
    expect(of(tie, 'heal')[0].data).toMatchObject({ target: 'a_pal' });
  });

  it('a dead stand-in stops acting', () => {
    const sim = newSim();
    sim.at(1500, EventClass.SpellHit, () => void sim.damage('d1', 1000000, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    sim.run();
    const d1 = of(sim, 'damage').filter((e) => e.data.source === 'd1').map((e) => e.t);
    expect(d1).toEqual([1000]);
  });

  it('nothing happens after the outcome', () => {
    const sim = newSim();
    sim.at(1500, EventClass.SpellHit, () => void sim.damage('boss', 1000000, { sourceId: 't1', ability: 'smash', school: 'physical' }, []));
    sim.run();
    expect(sim.outcome).toBeTruthy();
    const end = sim.outcome ? sim.now : 0;
    expect(of(sim, 'damage').filter((e) => e.data.source?.toString().match(/^(t1|d1|d2)$/) && e.t > 1500)).toEqual([]);
    expect(of(sim, 'heal').filter((e) => e.t > end)).toEqual([]);
  });

  it('ratePerSecond 0 produces no events', () => {
    const sim = new Simulation({ seed: 6, maxDurationMs: 3500, sampleIntervalMs: 1000 });
    sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1000000, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 5, boundingRadius: 2 });
    for (const [id, role] of [['t0', 'tank'], ['h0', 'healer']] as const) {
      const m = standin(id, role, 0);
      sim.addUnit({ id, name: id, kind: 'player', role, maxHealth: 40000, pos: { x: 6, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
      installStandin(sim, m);
    }
    sim.at(500, EventClass.SpellHit, () => void sim.damage('t0', 1000, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    sim.run();
    expect(of(sim, 'heal')).toEqual([]);
    expect(of(sim, 'damage').filter((e) => e.data.source !== 'boss')).toEqual([]);
  });
});
