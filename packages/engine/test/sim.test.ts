import { describe, expect, it } from 'vitest';
import { startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const player = { kind: 'player' as const, role: 'ranged' as const, maxHealth: 1000, speedYdPerSec: 5, combatReach: 1.5, boundingRadius: 0.389 };
const hit = (sourceId: string) => ({ sourceId, ability: 'test', school: 'physical' as const });

function newSim(maxDurationMs = 10000) {
  const sim = new Simulation({ seed: 1, maxDurationMs, sampleIntervalMs: 1000 });
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 100000, pos: { x: 0, y: 0 }, speedYdPerSec: 7, combatReach: 5, boundingRadius: 2 });
  sim.addUnit({ ...player, id: 'p1', name: 'P1', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...player, id: 'p2', name: 'P2', pos: { x: 5, y: 0 } });
  return sim;
}

const kinds = (sim: Simulation) => sim.trace.list().map((e) => e.kind);

describe('Simulation', () => {
  it('a unit killed in a millisecond cannot be healed later in that millisecond (§8.2, A-008)', () => {
    const sim = newSim();
    const heals: (string | null)[] = [];
    sim.at(100, EventClass.SpellHit, () => {
      sim.damage('p1', 5000, hit('boss'), []);
    });
    sim.at(100, EventClass.SpellHit, () => {
      heals.push(sim.heal('p1', 500, hit('p2'), []));
    });
    sim.run();
    expect(heals).toEqual([null]);
    expect(sim.unit('p1').health).toBe(0);
    expect(kinds(sim)).toEqual(['damage', 'death', 'outcome']);
    expect(sim.trace.list()[0].data).toMatchObject({ amount: 1000, overkill: 4000 });
    expect(sim.outcome?.kind).toBe('timeout');
  });

  it('runs same-millisecond events by class (A-001)', () => {
    const sim = newSim();
    const order: string[] = [];
    sim.at(50, EventClass.Decision, () => order.push('decision'));
    sim.at(50, EventClass.SpellHit, () => order.push('hit'));
    sim.run();
    expect(order).toEqual(['hit', 'decision']);
  });

  it('samples positions during a move (§8.3)', () => {
    const sim = newSim(3000);
    sim.at(0, EventClass.Decision, () => {
      sim.startMove('p1', { x: 10, y: 0 }, []);
    });
    sim.run();
    const xs = sim.trace.build(meta()).snapshots.map((s) => [s.t, s.units.find((u) => u.id === 'p1')!.x]);
    expect(xs).toEqual([
      [0, 0],
      [1000, 5],
      [2000, 10],
      [3000, 10],
    ]);
  });

  it('a new move starts from the current position', () => {
    const sim = newSim(3000);
    sim.at(0, EventClass.Decision, () => {
      sim.startMove('p1', { x: 10, y: 0 }, []);
    });
    sim.at(1000, EventClass.Decision, () => {
      sim.startMove('p1', { x: 5, y: 10 }, []);
    });
    sim.run();
    const second = sim.trace.list().filter((e) => e.kind === 'move_start')[1];
    expect(second.data).toMatchObject({ fromX: 5, fromY: 0, toX: 5, toY: 10, arrivalMs: 3000 });
  });

  it('ends with kill when every boss dies', () => {
    const sim = newSim();
    sim.at(100, EventClass.SpellHit, () => {
      sim.damage('boss', 1e6, hit('p1'), []);
    });
    expect(sim.run().kind).toBe('kill');
    expect(sim.outcome?.atMs).toBe(100);
  });

  it('ends with wipe when every player dies', () => {
    const sim = newSim();
    sim.at(100, EventClass.SpellHit, () => {
      sim.damage('p1', 1e6, hit('boss'), []);
      sim.damage('p2', 1e6, hit('boss'), []);
    });
    expect(sim.run().kind).toBe('wipe');
  });

  it('ends with timeout at the maximum duration', () => {
    const sim = newSim(5000);
    sim.at(9000, EventClass.SpellHit, () => {
      throw new Error('must not run');
    });
    const outcome = sim.run();
    expect(outcome).toMatchObject({ kind: 'timeout', atMs: 5000 });
  });

  it('refuses to schedule in the past', () => {
    const sim = newSim();
    sim.at(100, EventClass.SpellHit, () => {
      expect(() => sim.at(50, EventClass.SpellHit, () => {})).toThrow(/before now/);
    });
    sim.run();
  });

  it('death removes auras with reason death and cancels the cast', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'mark', durationMs: 5000, maxStacks: 1 });
    sim.at(0, EventClass.SpellHit, () => {
      const p1 = sim.unit('p1');
      p1.auras.set('mark|boss', {
        auraId: 'mark',
        casterId: 'boss',
        stacks: 1,
        appliedMs: 0,
        expiresMs: 5000,
        refreshedMs: 0,
        expiry: sim.at(5000, EventClass.AuraExpiry, () => {}),
        tick: null,
        nextTickMs: 0,
        appliedEvent: '',
        viaArea: false,
      });
      sim.damage('p1', 1e6, hit('boss'), []);
    });
    sim.run();
    const removed = sim.trace.list().find((e) => e.kind === 'aura_removed');
    expect(removed?.data).toMatchObject({ unit: 'p1', aura: 'mark', reason: 'death' });
    expect(sim.unit('p1').auras.size).toBe(0);
  });

  it('a listener cannot heal a unit that took a lethal hit', () => {
    const sim = newSim();
    const heals: (string | null)[] = [];
    sim.subscribe((ev) => {
      if (ev.kind === 'damage') heals.push(sim.heal('p1', 500, hit('p2'), [ev.id]));
    });
    sim.at(100, EventClass.SpellHit, () => {
      sim.damage('p1', 5000, hit('boss'), []);
    });
    sim.run();
    expect(heals).toEqual([null]);
    expect(sim.unit('p1').alive).toBe(false);
    expect(sim.unit('p1').health).toBe(0);
    expect(kinds(sim)).not.toContain('heal');
  });

  it('a listener damaging the unit again on the lethal hit yields exactly one death', () => {
    const sim = newSim();
    sim.subscribe((ev) => {
      if (ev.kind === 'damage') sim.damage('p1', 10, hit('boss'), [ev.id]);
    });
    sim.at(100, EventClass.SpellHit, () => {
      sim.damage('p1', 5000, hit('boss'), []);
    });
    sim.run();
    expect(kinds(sim).filter((k) => k === 'death')).toHaveLength(1);
    expect(kinds(sim).filter((k) => k === 'damage')).toHaveLength(1);
  });

  it('startMove with an invalid target throws and keeps the previous move', () => {
    const sim = newSim(5000);
    sim.at(0, EventClass.Decision, () => {
      sim.startMove('p1', { x: 5, y: 0 }, []);
    });
    sim.at(500, EventClass.Decision, () => {
      expect(() => sim.startMove('p1', { x: Number.NaN, y: 0 }, [])).toThrow('invalid move target for p1');
      expect(() => sim.startMove('p1', { x: 0, y: Number.POSITIVE_INFINITY }, [])).toThrow('invalid move target for p1');
    });
    sim.run();
    const ends = sim.trace.list().filter((e) => e.kind === 'move_end');
    expect(ends).toHaveLength(1);
    expect(ends[0].data).toMatchObject({ x: 5, y: 0, stopped: false });
    expect(sim.trace.list().filter((e) => e.kind === 'move_start')).toHaveLength(1);
  });

  it('startMove stores a copy of the target', () => {
    const sim = newSim(5000);
    const to = { x: 5, y: 0 };
    sim.at(0, EventClass.Decision, () => {
      sim.startMove('p1', to, []);
      to.x = 100;
    });
    sim.run();
    expect(sim.unit('p1').pos).toEqual({ x: 5, y: 0 });
  });

  it('damage and heal reject non-finite amounts', () => {
    const sim = newSim();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => sim.damage('p1', bad, hit('boss'), [])).toThrow(/invalid amount/);
      expect(() => sim.heal('p1', bad, hit('boss'), [])).toThrow(/invalid amount/);
    }
    expect(sim.trace.list()).toHaveLength(0);
  });

  it('writes no damage or heal after the outcome event', () => {
    const sim = newSim();
    sim.subscribe((ev) => {
      if (ev.kind === 'outcome') {
        expect(sim.damage('p2', 10, hit('boss'), [ev.id])).toBeNull();
        expect(sim.heal('p2', 10, hit('boss'), [ev.id])).toBeNull();
      }
    });
    sim.at(100, EventClass.SpellHit, () => {
      sim.damage('boss', 1e6, hit('p1'), []);
    });
    sim.run();
    const list = sim.trace.list();
    const idx = list.findIndex((e) => e.kind === 'outcome');
    expect(list.slice(idx + 1)).toEqual([]);
  });

  it('death mid-move freezes the position and writes no move_end (A-013)', () => {
    const sim = newSim(5000);
    sim.at(0, EventClass.Decision, () => {
      sim.startMove('p1', { x: 10, y: 0 }, []);
    });
    sim.at(1000, EventClass.SpellHit, () => {
      sim.damage('p1', 1e6, hit('boss'), []);
    });
    sim.run();
    expect(sim.unit('p1').pos).toEqual({ x: 5, y: 0 });
    expect(sim.unit('p1').move).toBeNull();
    expect(kinds(sim)).not.toContain('move_end');
  });

  it('a second move_start ends the first move without a move_end (A-013)', () => {
    const sim = newSim(5000);
    sim.at(0, EventClass.Decision, () => {
      sim.startMove('p1', { x: 10, y: 0 }, []);
    });
    sim.at(1000, EventClass.Decision, () => {
      sim.startMove('p1', { x: 5, y: 10 }, []);
    });
    sim.run();
    const ends = sim.trace.list().filter((e) => e.kind === 'move_end');
    expect(ends).toHaveLength(1);
    expect(ends[0].t).toBe(3000);
    expect(ends[0].data).toMatchObject({ x: 5, y: 10, stopped: false });
  });

  it('death mid-cast writes no cast_interrupted and no cast_success (A-013)', () => {
    const sim = newSim(5000);
    sim.catalog.addSpell({ id: 'bolt', castTimeMs: 2000, gcdMs: 1500, cooldownMs: 0, rangeYd: 40, usableWhileMoving: false, target: 'unit', effects: [] });
    sim.at(0, EventClass.Decision, () => {
      startCast(sim, 'p1', 'bolt', 'boss', []);
    });
    sim.at(1000, EventClass.SpellHit, () => {
      sim.damage('p1', 1e6, hit('boss'), []);
    });
    sim.run();
    expect(sim.unit('p1').cast).toBeNull();
    expect(kinds(sim)).toContain('cast_start');
    expect(kinds(sim)).not.toContain('cast_interrupted');
    expect(kinds(sim)).not.toContain('cast_success');
  });

  it('stopMove emits move_end stopped at the interpolated position and cancels arrival', () => {
    const sim = newSim(5000);
    sim.at(0, EventClass.Decision, () => {
      sim.startMove('p1', { x: 10, y: 0 }, []);
    });
    sim.at(1000, EventClass.Decision, () => {
      sim.stopMove('p1', []);
    });
    sim.run();
    const ends = sim.trace.list().filter((e) => e.kind === 'move_end');
    expect(ends).toHaveLength(1);
    expect(ends[0].t).toBe(1000);
    expect(ends[0].data).toMatchObject({ x: 5, y: 0, stopped: true });
    expect(sim.unit('p1').pos).toEqual({ x: 5, y: 0 });
  });

  it('rounds damage and healing half-up to whole numbers (A-017)', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      sim.damage('p1', 100.5, hit('boss'), []);
      sim.damage('p2', 100.4, hit('boss'), []);
      sim.heal('p1', 2.5, hit('p2'), []);
    });
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind !== 'outcome').map((e) => [e.kind, e.data.amount])).toEqual([
      ['damage', 101],
      ['damage', 100],
      ['heal', 3],
    ]);
  });
});

function meta() {
  return {
    engineVersion: 'test',
    azerothcoreCommit: 'x',
    spellDataVersions: [],
    scenario: 's',
    plan: 'p',
    maxDurationMs: 1000,
    mistakes: [],
    boss: 'boss',
    difficulty: '25n',
    seed: 1,
    profile: 'azerothcore',
    aiUpdateIntervalMs: 10,
    sampleIntervalMs: 1000,
    units: [],
  };
}
