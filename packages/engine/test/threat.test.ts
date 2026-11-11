import { describe, expect, it } from 'vitest';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { ThreatManager, threatFor } from '../src/threat';

const player = { kind: 'player' as const, maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 1, maxDurationMs: 10000, sampleIntervalMs: 1000 });
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 8, boundingRadius: 0.31 });
  sim.addUnit({ ...player, id: 't1', name: 'T1', role: 'tank', pos: { x: 10, y: 0 } });
  sim.addUnit({ ...player, id: 'm1', name: 'M1', role: 'melee', pos: { x: -10, y: 0 } });
  sim.addUnit({ ...player, id: 'r1', name: 'R1', role: 'ranged', pos: { x: 30, y: 0 }, threatMultiplier: 2 });
  sim.addUnit({ ...player, id: 'h1', name: 'H1', role: 'healer', pos: { x: 0, y: 30 } });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  return { sim, threat };
}

const hit = (src: string) => ({ sourceId: src, ability: 'x', school: 'physical' as const });
const targets = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'threat_target').map((e) => [e.t, e.data.target]);

describe('ThreatManager', () => {
  it('the first unit on an empty list becomes the victim at once', () => {
    const { sim, threat } = newSim();
    threat.add('boss', 't1', 100);
    threat.add('boss', 'm1', 0);
    expect(threat.victim('boss')?.id).toBe('t1');
    expect(threatFor(sim)).toBe(threat);
  });

  it('damage threat uses the source multiplier; healing threat is half, split over listed creatures', () => {
    const { sim, threat } = newSim();
    threat.add('boss', 't1', 0);
    sim.at(10, EventClass.SpellHit, () => {
      sim.damage('boss', 1000, hit('r1'), []);
      sim.damage('t1', 500, hit('boss'), []);
      sim.heal('t1', 400, hit('h1'), []);
    });
    sim.run();
    expect(threat.threatOf('boss', 'r1')).toBe(2000);
    expect(threat.threatOf('boss', 'h1')).toBe(200);
  });

  it('keeps the victim below 110 %, switches above 130 %, and between only to a melee target', () => {
    const { sim, threat } = newSim();
    threat.add('boss', 't1', 1000);
    sim.at(100, EventClass.SpellHit, () => {
      threat.add('boss', 'm1', 1050); // 105 %: stays on t1
      threat.add('boss', 'r1', 1200); // 120 %, ranged: stays on t1 (m1 is below 110 %)
    });
    sim.at(1100, EventClass.SpellHit, () => threat.add('boss', 'm1', 100)); // m1 1150: 115 %, melee → takes over at the next update
    sim.at(2100, EventClass.SpellHit, () => threat.add('boss', 'r1', 400)); // r1 1600: > 130 % of 1150 → takes over
    sim.run();
    expect(targets(sim)).toEqual([
      [0, 't1'],
      [2000, 'm1'],
      [3000, 'r1'],
    ]);
  });

  it('reselects at once when the victim dies', () => {
    const { sim, threat } = newSim();
    threat.add('boss', 't1', 1000);
    threat.add('boss', 'm1', 10);
    sim.at(500, EventClass.SpellHit, () => {
      sim.damage('t1', 1e6, hit('boss'), []);
      expect(threat.victim('boss')?.id).toBe('m1');
    });
    sim.run();
  });

  it('only living players go onto living creatures; ties go to the lowest id', () => {
    const { threat } = newSim();
    expect(() => threat.add('t1', 'boss', 1)).toThrow(/players onto creatures/);
    threat.add('boss', 'm1', 5);
    threat.add('boss', 'h1', 5);
    expect(threat.listed('boss').map((u) => u.id)).toEqual(['h1', 'm1']);
  });
});
