import { describe, expect, it } from 'vitest';
import { checkCast, installCoreRules, interruptCast, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const dmg = (n: number) => [{ type: 'damage' as const, school: 'fire' as const, min: n, max: n }];

function newSim() {
  const sim = new Simulation({ seed: 5, maxDurationMs: 20000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  const body = { kind: 'creature' as const, maxHealth: 100000, speedYdPerSec: 7, combatReach: 0, boundingRadius: 0 };
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', role: 'boss', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'add', name: 'Add', role: 'add', pos: { x: 0, y: 5 } });
  sim.addUnit({ ...body, id: 'mage', name: 'Mage', kind: 'player', role: 'ranged', maxHealth: 1000, pos: { x: 20, y: 0 } });
  sim.catalog.addSpell({ id: 'bolt', castTimeMs: 2000, gcdMs: 1500, cooldownMs: 0, rangeYd: 30, usableWhileMoving: false, target: 'unit', effects: dmg(100) });
  sim.catalog.addSpell({ id: 'zap', castTimeMs: 0, gcdMs: 1500, cooldownMs: 6000, rangeYd: 30, usableWhileMoving: true, target: 'unit', effects: dmg(50) });
  sim.catalog.addSpell({ id: 'arrow', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 40, usableWhileMoving: true, target: 'unit', travelSpeedYdPerSec: 40, effects: dmg(10) });
  return sim;
}

const of = (sim: Simulation, kind: string) => sim.trace.list().filter((e) => e.kind === kind);

describe('casting', () => {
  it('a cast-time spell hits at completion; GCD starts at cast start', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => {
      expect(startCast(sim, 'mage', 'bolt', 'boss', []).ok).toBe(true);
      expect(sim.unit('mage').gcdUntilMs).toBe(1500);
    });
    sim.run();
    expect(of(sim, 'spell_hit').map((e) => e.t)).toEqual([2000]);
    expect(sim.unit('boss').health).toBe(99900);
  });

  it('GCD blocks the next GCD spell until it ends', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => {
      startCast(sim, 'mage', 'zap', 'boss', []);
      expect(checkCast(sim, 'mage', 'bolt', 'boss')).toEqual({ ok: false, reason: 'gcd' });
    });
    sim.at(1500, EventClass.Decision, () => expect(checkCast(sim, 'mage', 'bolt', 'boss')).toEqual({ ok: true }));
    sim.run();
  });

  it('cooldown starts when the cast succeeds', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'zap', 'boss', []));
    sim.at(5999, EventClass.Decision, () => expect(checkCast(sim, 'mage', 'zap', 'boss')).toEqual({ ok: false, reason: 'cooldown' }));
    sim.at(6000, EventClass.Decision, () => expect(checkCast(sim, 'mage', 'zap', 'boss')).toEqual({ ok: true }));
    sim.run();
  });

  it('moving interrupts a cast that is not usable while moving (boundary test)', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'bolt', 'boss', []));
    sim.at(1000, EventClass.Decision, () => void sim.startMove('mage', { x: 25, y: 0 }, []));
    sim.run();
    const interrupted = of(sim, 'cast_interrupted');
    expect(interrupted.map((e) => [e.t, e.data.reason])).toEqual([[1000, 'moved']]);
    expect(of(sim, 'spell_hit')).toHaveLength(0);
  });

  it('a cast-time spell cannot start while moving; an instant can', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => {
      sim.startMove('mage', { x: 25, y: 0 }, []);
      expect(checkCast(sim, 'mage', 'bolt', 'boss')).toEqual({ ok: false, reason: 'moving' });
      expect(checkCast(sim, 'mage', 'zap', 'boss')).toEqual({ ok: true });
    });
    sim.run();
  });

  it('range is checked again at completion', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'bolt', 'boss', []));
    sim.at(500, EventClass.Decision, () => void sim.startMove('boss', { x: -20, y: 0 }, []));
    sim.run();
    // At 2000 the boss has moved 10.5 yd: distance 30.5 > 30.
    expect(of(sim, 'cast_failed').map((e) => [e.t, e.data.reason])).toEqual([[2000, 'out_of_range']]);
  });

  it('travel time delays the hit', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'arrow', 'boss', []));
    sim.run();
    expect(of(sim, 'cast_success').map((e) => e.t)).toEqual([0]);
    expect(of(sim, 'spell_hit').map((e) => e.t)).toEqual([500]);
  });

  it('fails at completion when the target died during the cast', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'bolt', 'add', []));
    sim.at(1000, EventClass.SpellHit, () => void sim.damage('add', 1e6, { sourceId: 'boss', ability: 'x', school: 'physical' }, []));
    sim.run();
    expect(of(sim, 'cast_failed').map((e) => e.data.reason)).toEqual(['target_dead']);
  });

  it('writes cast_failed with the reason when a cast cannot start', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => {
      const r = startCast(sim, 'mage', 'nope', 'boss', []);
      expect(r).toMatchObject({ ok: false, reason: 'unknown_spell' });
    });
    sim.run();
    expect(of(sim, 'cast_failed')).toHaveLength(1);
  });

  it('interrupt then recast at the same millisecond yields exactly one hit, at the new cast end', () => {
    const sim = newSim();
    sim.catalog.addSpell({ id: 'slow', castTimeMs: 2000, gcdMs: 0, cooldownMs: 0, rangeYd: 30, usableWhileMoving: false, target: 'unit', effects: dmg(100) });
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'slow', 'boss', []));
    sim.at(1000, EventClass.Decision, () => {
      expect(interruptCast(sim, 'mage', 'stopped', [])).not.toBeNull();
      expect(startCast(sim, 'mage', 'slow', 'boss', []).ok).toBe(true);
    });
    sim.run();
    expect(of(sim, 'spell_hit').map((e) => e.t)).toEqual([3000]);
    expect(sim.unit('boss').health).toBe(99900);
  });

  it('a caster who dies mid-cast produces no cast_success and no hit', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'bolt', 'boss', []));
    sim.at(1000, EventClass.SpellHit, () => void sim.damage('mage', 1e6, { sourceId: 'boss', ability: 'x', school: 'physical' }, []));
    sim.run();
    expect(of(sim, 'cast_success')).toHaveLength(0);
    expect(of(sim, 'spell_hit')).toHaveLength(0);
  });

  it('a target that dies while the projectile is in flight takes no hit', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'arrow', 'boss', []));
    sim.at(200, EventClass.SpellHit, () => void sim.damage('boss', 1e9, { sourceId: 'add', ability: 'x', school: 'physical' }, []));
    sim.run();
    expect(of(sim, 'cast_success')).toHaveLength(1);
    expect(of(sim, 'spell_hit')).toHaveLength(0);
    expect(of(sim, 'damage').map((e) => e.data.ability)).toEqual(['x']);
  });

  it('a cast-time spell usable while moving is not interrupted by movement', () => {
    const sim = newSim();
    sim.catalog.addSpell({ id: 'walkcast', castTimeMs: 2000, gcdMs: 0, cooldownMs: 0, rangeYd: 60, usableWhileMoving: true, target: 'unit', effects: dmg(100) });
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'walkcast', 'boss', []));
    sim.at(500, EventClass.Decision, () => void sim.startMove('mage', { x: 25, y: 0 }, []));
    sim.run();
    expect(of(sim, 'cast_interrupted')).toHaveLength(0);
    expect(of(sim, 'spell_hit').map((e) => e.t)).toEqual([2000]);
  });

  it('does not start the cooldown when completion fails', () => {
    const sim = newSim();
    sim.catalog.addSpell({ id: 'cdbolt', castTimeMs: 2000, gcdMs: 0, cooldownMs: 6000, rangeYd: 30, usableWhileMoving: false, target: 'unit', effects: dmg(100) });
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'cdbolt', 'boss', []));
    sim.at(500, EventClass.Decision, () => void sim.startMove('boss', { x: -20, y: 0 }, []));
    sim.at(2000, EventClass.Decision, () => expect(sim.unit('mage').cooldowns.get('cdbolt')).toBeUndefined());
    sim.run();
    expect(of(sim, 'cast_failed').map((e) => e.data.reason)).toEqual(['out_of_range']);
    expect(sim.unit('mage').cooldowns.has('cdbolt')).toBe(false);
  });
});
