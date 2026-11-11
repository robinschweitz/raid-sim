import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import { installCoreRules, startCast } from '../src/casting';
import { PlanSchema, type Plan } from '../src/plan/schema';
import { EventClass } from '../src/queue';
import { BUILTIN_ACTIONS, RuleEngine, type ActionHandler } from '../src/rules';
import { Simulation } from '../src/sim';

const fixed = { minMs: 300, maxMs: 300 };
const member = (id: string) => ({ id, name: id, kind: 'standin', role: 'ranged', maxHealth: 10000, ratePerSecond: 0, reaction: fixed });

function plan(rules: unknown[]): Plan {
  return PlanSchema.parse({
    id: 'p',
    boss: 'boss',
    roster: [member('t1'), member('t2'), member('p1')],
    spots: { home: { x: 0, y: 0 }, a: { x: 10, y: 0 }, b: { x: -10, y: 0 } },
    phases: [{ phase: 'default', assignments: { t1: 'home', t2: 'home', p1: 'home' } }],
    rules,
  });
}

function newSim(p: Plan, extra: [string, ActionHandler][] = [], maxDurationMs = 12000) {
  const sim = new Simulation({ seed: 4, maxDurationMs, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1000000, pos: { x: 0, y: 30 }, speedYdPerSec: 7, combatReach: 5, boundingRadius: 2 });
  for (const id of ['t1', 't2', 'p1']) {
    sim.addUnit({ id, name: id, kind: 'player', role: 'ranged', maxHealth: 10000, pos: { x: 0, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  }
  const tank = { id: 't1' };
  for (const aura of ['spore', 'other', 'third', 'bloat']) sim.catalog.addAura({ id: aura, durationMs: 60000, maxStacks: 20 });
  sim.catalog.addSpell({ id: 'long', castTimeMs: 3000, gcdMs: 0, cooldownMs: 0, rangeYd: 100, usableWhileMoving: false, target: 'self', effects: [] });
  const engine = new RuleEngine(sim, p, new Map([...BUILTIN_ACTIONS, ...extra]), { currentTank: () => sim.unit(tank.id) });
  engine.install();
  return { sim, engine, tank };
}

const of = (sim: Simulation, kind: string) => sim.trace.list().filter((e) => e.kind === kind);
const at = (sim: Simulation, t: number, fn: () => void) => sim.at(t, EventClass.SpellHit, fn);

describe('RuleEngine (§8.5)', () => {
  it('acts after the reaction delay and links the cause', () => {
    const { sim } = newSim(plan([{ id: 'run', who: ['p1'], when: { on: 'aura_applied', aura: 'spore', target: 'self' }, do: { do: 'move_to', spot: 'a' } }]));
    at(sim, 1000, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    sim.run();
    const fired = of(sim, 'rule_fired')[0];
    const move = of(sim, 'move_start')[0];
    expect([fired.t, move.t]).toEqual([1000, 1300]);
    expect(move.causes).toEqual([fired.id]);
  });

  it('a stack trigger fires once when crossing the threshold and re-arms after removal', () => {
    const calls: number[] = [];
    const taunt: ActionHandler = (ctx) => (calls.push(ctx.sim.now), { ok: true });
    const { sim } = newSim(
      plan([{ id: 'swap', who: ['t2'], when: { on: 'aura_stacks', aura: 'bloat', target: 'current_tank', atLeast: 3 }, do: { do: 'taunt', target: 'boss' } }]),
      [['taunt', taunt]],
    );
    for (const t of [1000, 2000, 3000, 4000]) at(sim, t, () => void applyAura(sim, 'bloat', 'boss', 't1', []));
    at(sim, 5000, () => void removeAuras(sim, 't1', 'bloat', 'removed', []));
    for (const t of [6000, 7000, 8000]) at(sim, t, () => void applyAura(sim, 'bloat', 'boss', 't1', []));
    sim.run();
    expect(calls).toEqual([3300, 8300]);
  });

  it('a running higher-priority move makes a lower one fail; a higher one pre-empts (A-010)', () => {
    const { sim } = newSim(
      plan([
        { id: 'hi', who: ['p1'], when: { on: 'aura_applied', aura: 'spore', target: 'self' }, do: { do: 'move_to', spot: 'a' }, priority: 80 },
        { id: 'lo', who: ['p1'], when: { on: 'aura_applied', aura: 'other', target: 'self' }, do: { do: 'move_to', spot: 'b' }, priority: 50 },
        { id: 'urgent', who: ['p1'], when: { on: 'aura_applied', aura: 'third', target: 'self' }, do: { do: 'move_to', spot: 'b' }, priority: 90 },
      ]),
    );
    at(sim, 1000, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    at(sim, 1500, () => void applyAura(sim, 'other', 'boss', 'p1', []));
    at(sim, 2000, () => void applyAura(sim, 'third', 'boss', 'p1', []));
    sim.run();
    expect(of(sim, 'action_failed').map((e) => [e.t, e.data.rule, e.data.reason])).toEqual([[1800, 'lo', 'busy']]);
    expect(of(sim, 'move_start').map((e) => [e.t, e.data.toX])).toEqual([
      [1300, 10],
      [2300, -10],
    ]);
  });

  it('retries a failed action and supports time triggers', () => {
    const calls: number[] = [];
    const flaky: ActionHandler = (ctx) => {
      calls.push(ctx.sim.now);
      return calls.length === 1 ? { ok: false, reason: 'out_of_range' } : { ok: true };
    };
    const { sim } = newSim(
      plan([{ id: 'swap', who: ['t2'], when: { on: 'time', atMs: 1000 }, do: { do: 'taunt', target: 'boss' }, retry: { times: 2, everyMs: 500 } }]),
      [['taunt', flaky]],
    );
    sim.run();
    expect(calls).toEqual([1300, 1800]);
    expect(of(sim, 'action_failed').map((e) => [e.t, e.data.reason, e.data.attempt])).toEqual([[1300, 'out_of_range', 0]]);
  });

  it('respects the rule cooldown', () => {
    const { sim } = newSim(
      plan([{ id: 'run', who: ['p1'], when: { on: 'aura_applied', aura: 'spore', target: 'self' }, do: { do: 'move_to', spot: 'a' }, cooldownMs: 5000 }]),
    );
    at(sim, 1000, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    at(sim, 3000, () => void applyAura(sim, 'spore', 't1', 'p1', []));
    at(sim, 7000, () => void applyAura(sim, 'spore', 't2', 'p1', []));
    sim.run();
    expect(of(sim, 'rule_fired').map((e) => e.t)).toEqual([1000, 7000]);
  });

  it('stop_casting interrupts the actor', () => {
    const { sim } = newSim(plan([{ id: 'stop', who: ['p1'], when: { on: 'time', atMs: 1000 }, do: { do: 'stop_casting' } }]));
    at(sim, 0, () => void startCast(sim, 'p1', 'long', 'p1', []));
    sim.run();
    expect(of(sim, 'cast_interrupted').map((e) => [e.t, e.data.reason])).toEqual([[1300, 'stopped']]);
  });

  it('a dead actor does not act; isMoving clears on arrival', () => {
    const { sim, engine } = newSim(plan([{ id: 'run', who: ['p1', 't2'], when: { on: 'time', atMs: 1000 }, do: { do: 'move_to', spot: 'a' } }]));
    at(sim, 500, () => void sim.damage('t2', 1e6, { sourceId: 'boss', ability: 'x', school: 'physical' }, []));
    let movingDuring = false;
    at(sim, 2000, () => {
      movingDuring = engine.isMoving('p1');
    });
    sim.run();
    expect(of(sim, 'move_start').map((e) => e.data.unit)).toEqual(['p1']);
    expect(movingDuring).toBe(true);
    expect(engine.isMoving('p1')).toBe(false);
  });

  it('keeps condition state per watched unit, so a tank swap re-arms the rule', () => {
    const calls: number[] = [];
    const taunt: ActionHandler = (ctx) => (calls.push(ctx.sim.now), { ok: true });
    const { sim, tank } = newSim(
      plan([{ id: 'swap', who: ['t2'], when: { on: 'aura_stacks', aura: 'bloat', target: 'current_tank', atLeast: 3 }, do: { do: 'taunt', target: 'boss' } }]),
      [['taunt', taunt]],
    );
    for (const t of [1500, 2500]) at(sim, t, () => void applyAura(sim, 'bloat', 'boss', 't2', []));
    for (const t of [1000, 2000, 3000]) at(sim, t, () => void applyAura(sim, 'bloat', 'boss', 't1', []));
    at(sim, 4000, () => void (tank.id = 't2'));
    at(sim, 5000, () => void applyAura(sim, 'bloat', 'boss', 't2', []));
    sim.run();
    expect(calls).toEqual([3300, 5300]);
  });

  it('tracks unit conditions even while the unit is not the reference (removal during a tank swap re-arms)', () => {
    const calls: number[] = [];
    const taunt: ActionHandler = (ctx) => (calls.push(ctx.sim.now), { ok: true });
    const { sim, tank } = newSim(
      plan([{ id: 'swap', who: ['p1'], when: { on: 'aura_stacks', aura: 'bloat', target: 'current_tank', atLeast: 1 }, do: { do: 'taunt', target: 'boss' } }]),
      [['taunt', taunt]],
    );
    at(sim, 1000, () => void applyAura(sim, 'bloat', 'boss', 't1', []));
    at(sim, 2000, () => void (tank.id = 't2'));
    at(sim, 3000, () => void removeAuras(sim, 't1', 'bloat', 'removed', []));
    at(sim, 4000, () => void (tank.id = 't1'));
    at(sim, 5000, () => void applyAura(sim, 'bloat', 'boss', 't1', []));
    sim.run();
    expect(calls).toEqual([1300, 5300]);
  });

  it('a cooldown does not swallow the edge', () => {
    const { sim } = newSim(
      plan([{ id: 'run', who: ['p1'], when: { on: 'aura_stacks', aura: 'bloat', target: 'self', atLeast: 1 }, do: { do: 'move_to', spot: 'a' }, cooldownMs: 5000 }]),
    );
    at(sim, 1000, () => void applyAura(sim, 'bloat', 'boss', 'p1', []));
    at(sim, 2000, () => void removeAuras(sim, 'p1', 'bloat', 'removed', []));
    at(sim, 3000, () => void applyAura(sim, 'bloat', 'boss', 'p1', []));
    at(sim, 4000, () => void applyAura(sim, 'bloat', 'boss', 'p1', []));
    at(sim, 7000, () => void applyAura(sim, 'bloat', 'boss', 'p1', []));
    sim.run();
    expect(of(sim, 'rule_fired').map((e) => e.t)).toEqual([1000, 7000]);
  });

  it('a phase change moves members whose spot changes, not those already in place or dead', () => {
    const p = PlanSchema.parse({
      id: 'p',
      boss: 'boss',
      roster: [member('t1'), member('t2'), member('p1')],
      spots: { home: { x: 0, y: 0 }, a: { x: 10, y: 0 }, b: { x: -10, y: 0 } },
      phases: [
        { phase: 'default', assignments: { t1: 'home', t2: 'home', p1: 'home' } },
        { phase: 'two', assignments: { t1: 'a', t2: 'b' } },
      ],
      rules: [],
    });
    const { sim, engine } = newSim(p);
    at(sim, 500, () => void sim.damage('t2', 1e6, { sourceId: 'boss', ability: 'x', school: 'physical' }, []));
    at(sim, 1000, () => {
      sim.phase = 'two';
      sim.emit('phase_change', { boss: 'boss', phase: 'two' }, []);
      expect(engine.isMoving('t1')).toBe(true);
      expect(engine.isMoving('p1')).toBe(false);
    });
    sim.run();
    expect(of(sim, 'move_start').map((e) => [e.t, e.data.unit, e.data.toX])).toEqual([[1000, 't1', 10]]);
  });

  it('health_below fires once when crossing and re-arms after healing back above', () => {
    const { sim } = newSim(plan([{ id: 'low', who: ['p1'], when: { on: 'health_below', target: 'self', pct: 50 }, do: { do: 'move_to', spot: 'a' } }]));
    const hit = (n: number) => void sim.damage('p1', n, { sourceId: 'boss', ability: 'x', school: 'physical' }, []);
    at(sim, 1000, () => hit(6000));
    at(sim, 2000, () => hit(100));
    at(sim, 3000, () => void sim.heal('p1', 8000, { sourceId: 't2', ability: 'mend', school: 'holy' }, []));
    at(sim, 4000, () => hit(6000));
    at(sim, 5000, () => hit(1e6));
    sim.run();
    expect(of(sim, 'rule_fired').map((e) => e.t)).toEqual([1000, 4000]);
  });

  it('a cast_start trigger fires on the matching cast', () => {
    const { sim } = newSim(plan([{ id: 'react', who: ['p1'], when: { on: 'cast_start', spell: 'long', caster: 'self' }, do: { do: 'move_to', spot: 'a' } }]));
    at(sim, 1000, () => void startCast(sim, 'p1', 'long', 'p1', []));
    at(sim, 1500, () => void startCast(sim, 't1', 'long', 't1', []));
    sim.run();
    expect(of(sim, 'rule_fired').map((e) => [e.t, e.data.actor])).toEqual([[1000, 'p1']]);
    expect(of(sim, 'move_start').map((e) => [e.t, e.data.toX])).toEqual([[1300, 10]]);
  });

  it('return_to_assignment walks back to the assigned spot', () => {
    const { sim } = newSim(
      plan([
        { id: 'out', who: ['p1'], when: { on: 'time', atMs: 1000 }, do: { do: 'move_to', spot: 'a' } },
        { id: 'back', who: ['p1'], when: { on: 'time', atMs: 3000 }, do: { do: 'return_to_assignment' } },
      ]),
    );
    sim.run();
    expect(of(sim, 'move_start').map((e) => [e.t, e.data.toX])).toEqual([
      [1300, 10],
      [3300, 0],
    ]);
  });
});
