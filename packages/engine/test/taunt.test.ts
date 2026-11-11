import { describe, expect, it } from 'vitest';
import { applyEffects } from '../src/effects';
import { PlanSchema } from '../src/plan/schema';
import { EventClass } from '../src/queue';
import { BUILTIN_ACTIONS, RuleEngine, createTauntAction } from '../src/rules';
import { Simulation } from '../src/sim';
import { ThreatManager } from '../src/threat';

const player = { kind: 'player' as const, maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 1, maxDurationMs: 20000, sampleIntervalMs: 1000 });
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 8, boundingRadius: 0.31 });
  sim.addUnit({ ...player, id: 't1', name: 'T1', role: 'tank', pos: { x: 10, y: 0 } });
  sim.addUnit({ ...player, id: 't2', name: 'T2', role: 'tank', pos: { x: -10, y: 0 } });
  sim.addUnit({ ...player, id: 'far', name: 'Far', role: 'tank', pos: { x: 60, y: 0 } });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  threat.add('boss', 't1', 5000);
  threat.add('boss', 't2', 100);
  threat.add('boss', 'far', 0);
  return { sim, threat };
}

describe('taunt', () => {
  it('a taunt effect takes the victim at once, matches the top threat and holds for its duration', () => {
    const { sim, threat } = newSim();
    sim.at(1000, EventClass.SpellHit, () => applyEffects(sim, [{ type: 'taunt', durationMs: 3000 }], { casterId: 't2', targetId: 'boss', ability: 'taunt', causes: [] }));
    sim.at(1500, EventClass.SpellHit, () => threat.add('boss', 't1', 5000)); // t1 at 200 % during the taunt
    sim.run();
    const victims = sim.trace.list().filter((e) => e.kind === 'threat_target').map((e) => [e.t, e.data.target]);
    expect(victims).toEqual([
      [0, 't1'],
      [1000, 't2'],
      [4000, 't1'],
    ]);
    expect(threat.threatOf('boss', 't2')).toBe(5000);
  });

  it('the rule action checks range and its cooldown', () => {
    const { sim } = newSim();
    const plan = PlanSchema.parse({
      id: 'p',
      boss: 'boss',
      roster: ['t1', 't2', 'far'].map((id) => ({ id, name: id, kind: 'standin', role: 'tank', maxHealth: 100000, ratePerSecond: 0, reaction: { minMs: 0, maxMs: 0 } })),
      spots: { home: { x: 0, y: 0 } },
      phases: [{ phase: 'default', assignments: { t1: 'home', t2: 'home', far: 'home' } }],
      rules: [
        { id: 'swap', who: ['t2', 'far'], when: { on: 'time', atMs: 1000 }, do: { do: 'taunt', target: 'boss' } },
        { id: 'again', who: ['t2'], when: { on: 'time', atMs: 2000 }, do: { do: 'taunt', target: 'boss' } },
      ],
    });
    const actions = new Map([...BUILTIN_ACTIONS, ['taunt', createTauntAction({ rangeYd: 30, cooldownMs: 8000, durationMs: 3000 })]]);
    new RuleEngine(sim, plan, actions, { currentTank: () => null, primaryBoss: () => sim.unit('boss') }).install();
    sim.run();
    const failed = sim.trace.list().filter((e) => e.kind === 'action_failed').map((e) => [e.t, e.data.actor, e.data.reason]);
    expect(failed).toEqual([
      [1000, 'far', 'out_of_range'],
      [2000, 't2', 'cooldown'],
    ]);
    expect(sim.trace.list().filter((e) => e.kind === 'taunt').map((e) => [e.t, e.data.actor])).toEqual([[1000, 't2']]);
  });
});
