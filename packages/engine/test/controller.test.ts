import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { installCoreRules } from '../src/casting';
import { ActorController, type ActorPolicy, type ControllerHooks } from '../src/controller';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import type { ActorView } from '../src/view';

const dmg = (n: number) => [{ type: 'damage' as const, school: 'fire' as const, min: n, max: n }];
const hooks = (ruleMoving = false): ControllerHooks => ({
  isRuleMoving: () => ruleMoving,
  spots: () => ({ home: { x: 1, y: 2 } }),
  assignment: () => 'home',
});

function newSim(maxDurationMs = 5000) {
  const sim = new Simulation({ seed: 2, maxDurationMs, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  const body = { maxHealth: 10000, speedYdPerSec: 7, combatReach: 0, boundingRadius: 0 };
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1000000, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'mage', name: 'Mage', kind: 'player', role: 'ranged', pos: { x: 20, y: 0 } });
  sim.addUnit({ ...body, id: 'healer', name: 'Healer', kind: 'player', role: 'healer', pos: { x: 25, y: 0 } });
  sim.addUnit({ ...body, id: 'tank', name: 'Tank', kind: 'player', role: 'tank', pos: { x: 2, y: 0 } });
  sim.catalog.addSpell({ id: 'bolt', castTimeMs: 1500, gcdMs: 1500, cooldownMs: 0, rangeYd: 30, usableWhileMoving: false, target: 'unit', effects: dmg(100) });
  sim.catalog.addSpell({ id: 'flash', castTimeMs: 0, gcdMs: 0, cooldownMs: 10000, rangeYd: 30, usableWhileMoving: true, target: 'unit', effects: dmg(10) });
  sim.catalog.addSpell({ id: 'mend', castTimeMs: 0, gcdMs: 1500, cooldownMs: 0, rangeYd: 40, usableWhileMoving: true, target: 'unit', effects: [{ type: 'heal', min: 200, max: 200 }] });
  sim.catalog.addAura({ id: 'mark', durationMs: 4000, maxStacks: 1 });
  return sim;
}

const casterPolicy: ActorPolicy = {
  wakeOn: { anyHealthChange: false, anyAuraChange: false },
  decide: (v) =>
    v.canCast('flash', 'boss').ok
      ? { type: 'cast', spell: 'flash', target: 'boss' }
      : v.canCast('bolt', 'boss').ok
        ? { type: 'cast', spell: 'bolt', target: 'boss' }
        : { type: 'none' },
};

const healerPolicy: ActorPolicy = {
  wakeOn: { anyHealthChange: true, anyAuraChange: false },
  decide: (v) => {
    const hurt = v.units
      .filter((u) => u.kind === 'player' && u.alive && u.health < u.maxHealth)
      .sort((a, b) => a.health / a.maxHealth - b.health / b.maxHealth);
    const t = hurt[0];
    return t && v.canCast('mend', t.id).ok ? { type: 'cast', spell: 'mend', target: t.id } : { type: 'none' };
  },
};

describe('ActorController (§8.4)', () => {
  it('casts back to back and uses an off-GCD ability in the same wake-up', () => {
    const sim = newSim();
    new ActorController(sim, 'mage', casterPolicy, hooks()).install();
    sim.run();
    const casts = sim.trace
      .list()
      .filter((e) => e.kind === 'cast_start' && e.data.caster === 'mage')
      .map((e) => [e.t, e.data.spell]);
    expect(casts).toEqual([
      [0, 'flash'],
      [0, 'bolt'],
      [1500, 'bolt'],
      [3000, 'bolt'],
      [4500, 'bolt'],
    ]);
  });

  it('a healer wakes on damage to someone else and heals the lowest player', () => {
    const sim = newSim();
    new ActorController(sim, 'healer', healerPolicy, hooks()).install();
    sim.at(2000, EventClass.SpellHit, () => void sim.damage('tank', 300, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    sim.run();
    const heals = sim.trace
      .list()
      .filter((e) => e.kind === 'heal')
      .map((e) => [e.t, e.data.target, e.data.amount]);
    expect(heals).toEqual([
      [2000, 'tank', 200],
      [3500, 'tank', 100],
    ]);
  });

  it('the view holds frozen copies of visible state only (§8.6)', () => {
    const sim = newSim(1000);
    const views: ActorView[] = [];
    const probe: ActorPolicy = { wakeOn: { anyHealthChange: false, anyAuraChange: false }, decide: (v) => (views.push(v), { type: 'none' }) };
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'mark', 'boss', 'mage', []));
    new ActorController(sim, 'mage', probe, hooks()).install();
    sim.run();
    const v = views[0];
    expect(Object.keys(v).sort()).toEqual([
      'assignment',
      'canCast',
      'cooldownReadyAtMs',
      'gcdReadyAtMs',
      'now',
      'self',
      'spots',
      'timers',
      'units',
    ]);
    expect(v.self.auras).toEqual([{ aura: 'mark', caster: 'boss', stacks: 1, remainingMs: 4000 }]);
    expect(Object.keys(v.self).sort()).toEqual([
      'alive', 'auras', 'cast', 'combatReach', 'health', 'id', 'kind', 'maxHealth', 'moving', 'name', 'role', 'x', 'y',
    ]);
    expect(() => {
      (v.self as { health: number }).health = 1;
    }).toThrow(TypeError);
    expect(v.assignment).toBe('home');
  });

  it('policy moves are ignored while a plan rule move is running', () => {
    for (const ruleMoving of [true, false]) {
      const sim = newSim(1000);
      const mover: ActorPolicy = { wakeOn: { anyHealthChange: false, anyAuraChange: false }, decide: () => ({ type: 'move', to: { x: 30, y: 0 } }) };
      new ActorController(sim, 'mage', mover, hooks(ruleMoving)).install();
      sim.run();
      expect(sim.trace.list().some((e) => e.kind === 'move_start')).toBe(!ruleMoving);
    }
  });
});
