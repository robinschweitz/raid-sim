import { describe, expect, it } from 'vitest';
import { makeBossContext } from '../src/boss';
import { PlanSchema } from '../src/plan/schema';
import { EventClass } from '../src/queue';
import { BUILTIN_ACTIONS, RuleEngine } from '../src/rules';
import { Simulation } from '../src/sim';

const body = { maxHealth: 1000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 1, maxDurationMs: 5000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'festergut', name: 'Festergut', kind: 'creature', role: 'boss', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'putricide', name: 'Putricide', kind: 'creature', role: 'boss', pos: { x: 0, y: 50 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 10, y: 0 } });
  return sim;
}
const hit = { sourceId: 'p1', ability: 'x', school: 'physical' as const };

describe('encounter rules', () => {
  it('the fight is won when every unit in the kill set is dead', () => {
    const sim = newSim();
    sim.mustKill.add('festergut');
    sim.at(100, EventClass.SpellHit, () => void sim.damage('festergut', 1e6, hit, []));
    expect(sim.run()).toMatchObject({ kind: 'kill', atMs: 100 });
  });

  it("the plan reference 'boss' means the primary boss", () => {
    const sim = newSim();
    const plan = PlanSchema.parse({
      id: 'p',
      boss: 'festergut',
      roster: [{ id: 'p1', name: 'P1', kind: 'standin', role: 'ranged', maxHealth: 1000, ratePerSecond: 0, reaction: { minMs: 0, maxMs: 0 } }],
      spots: { home: { x: 10, y: 0 }, away: { x: 20, y: 0 } },
      phases: [{ phase: 'default', assignments: { p1: 'home' } }],
      rules: [{ id: 'dodge', who: ['p1'], when: { on: 'cast_start', spell: 'nova', caster: 'boss' }, do: { do: 'move_to', spot: 'away' } }],
    });
    sim.catalog.addSpell({ id: 'nova', castTimeMs: 1000, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: false, target: 'self', effects: [] });
    new RuleEngine(sim, plan, BUILTIN_ACTIONS, { currentTank: () => null, primaryBoss: () => sim.unit('festergut') }).install();
    sim.at(100, EventClass.Decision, () => {
      sim.emit('cast_start', { caster: 'putricide', spell: 'nova', target: 'putricide' });
      sim.emit('cast_start', { caster: 'festergut', spell: 'nova', target: 'festergut' });
    });
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'rule_fired')).toHaveLength(1);
  });

  it('scripts keep numeric state and can clear a published timer', () => {
    const sim = newSim();
    const ctx = makeBossContext(sim, 'festergut');
    expect(ctx.getData('inoculated_max')).toBeUndefined();
    ctx.setData('inoculated_max', 2);
    expect(ctx.getData('inoculated_max')).toBe(2);
    ctx.publishTimer('vile_gas', 30000, 40000, []);
    ctx.clearTimer('vile_gas', []);
    expect(sim.timerWindows.has('festergut|vile_gas')).toBe(false);
    expect(sim.trace.list().at(-1)?.data).toMatchObject({ ability: 'vile_gas', cleared: true });
  });
});
