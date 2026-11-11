import { describe, expect, it } from 'vitest';
import { makeBossContext } from '../src/boss';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { ThreatManager } from '../src/threat';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 9, maxDurationMs: 5000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, combatReach: 8, pos: { x: 0, y: 0 } });
  for (const [id, x] of [['t1', 10], ['m1', 11], ['r1', 30], ['r2', 35], ['h1', 25]] as const) {
    sim.addUnit({ ...body, id, name: id, kind: 'player', role: id.startsWith('t') ? 'tank' : 'ranged', pos: { x, y: 0 } });
  }
  sim.catalog.addSpell({ id: 'channel', castTimeMs: 3000, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: false, target: 'self', effects: [] });
  sim.catalog.addSpell({ id: 'blight', castTimeMs: 2000, gcdMs: 1500, cooldownMs: 10000, rangeYd: 5, usableWhileMoving: false, target: 'unit', effects: [{ type: 'damage', school: 'nature', min: 1, max: 1 }] });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  threat.add('boss', 't1', 100);
  for (const id of ['m1', 'r1', 'r2', 'h1']) threat.add('boss', id, 0);
  return sim;
}

describe('triggered casts', () => {
  it('ignore cast time, GCD, cooldown, casting state and range', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => {
      startCast(sim, 'boss', 'channel', 'boss', []);
      const r = startCast(sim, 'boss', 'blight', 'r2', [], { triggered: true });
      expect(r.ok).toBe(true);
      expect(sim.unit('boss').cast?.spellId).toBe('channel');
      expect(sim.unit('boss').cooldowns.get('blight')).toBeUndefined();
    });
    sim.run();
    const hit = sim.trace.list().find((e) => e.kind === 'spell_hit' && e.data.spell === 'blight');
    expect(hit?.t).toBe(0);
  });
});

describe('boss target selection', () => {
  it('picks from the threat list with distance limits, from its own stream', () => {
    const sim = newSim();
    const ctx = makeBossContext(sim, 'boss');
    expect(ctx.threatList().map((u) => u.id)).toEqual(['h1', 'm1', 'r1', 'r2', 't1']);
    for (let i = 0; i < 20; i++) {
      const far = ctx.selectTarget('vile_gas', { minDistanceYd: 5 });
      expect(['h1', 'r1', 'r2']).toContain(far?.id);
      const notTank = ctx.selectTarget('goo', { excludeVictim: true });
      expect(notTank?.id).not.toBe('t1');
    }
    expect(ctx.selectTarget('none', { minDistanceYd: 100 })).toBeNull();
  });
});
