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

  const kill = (sim: Simulation, id: string) => sim.damage(id, 1e9, { sourceId: 'boss', ability: 'test', school: 'nature' }, []);
  const failures = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'cast_failed');

  it('fails with a cast_failed entry for an unknown spell, a dead caster and a dead target', () => {
    const sim = newSim();
    const results: unknown[] = [];
    sim.at(0, EventClass.Decision, () => {
      kill(sim, 'r1');
      kill(sim, 'r2');
      results.push(startCast(sim, 'boss', 'nope', 't1', [], { triggered: true }));
      results.push(startCast(sim, 'r1', 'blight', 't1', [], { triggered: true }));
      results.push(startCast(sim, 'boss', 'blight', 'r2', [], { triggered: true }));
    });
    sim.run();
    expect(results).toMatchObject([
      { ok: false, reason: 'unknown_spell' },
      { ok: false, reason: 'dead' },
      { ok: false, reason: 'target_dead' },
    ]);
    expect(failures(sim).map((e) => e.data.reason)).toEqual(['unknown_spell', 'dead', 'target_dead']);
  });

  it('writes nothing when the fight is already over', () => {
    const sim = newSim();
    let result: unknown;
    sim.at(0, EventClass.Decision, () => {
      kill(sim, 'boss');
      const before = sim.trace.list().length;
      result = startCast(sim, 'boss', 'blight', 't1', [], { triggered: true });
      expect(sim.trace.list().length).toBe(before);
    });
    sim.run();
    expect(result).toMatchObject({ ok: false, reason: 'fight_over', event: '' });
    expect(failures(sim)).toEqual([]);
  });

  it('leaves the GCD alone and does not disturb a running channel', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => {
      startCast(sim, 'boss', 'channel', 'boss', []);
      expect(sim.unit('boss').gcdUntilMs).toBe(0);
      startCast(sim, 'boss', 'blight', 'r2', [], { triggered: true });
      expect(sim.unit('boss').gcdUntilMs).toBe(0);
    });
    sim.run();
    const done = sim.trace.list().find((e) => e.kind === 'cast_success' && e.data.spell === 'channel');
    expect(done?.t).toBe(3000);
  });

  it('is traced with castTimeMs 0 and triggered true', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'boss', 'blight', 'r2', [], { triggered: true }));
    sim.run();
    const start = sim.trace.list().find((e) => e.kind === 'cast_start');
    expect(start?.data).toMatchObject({ castTimeMs: 0, triggered: true });
  });

  it('keeps projectile travel time and fails if the target dies in flight', () => {
    const bolt = {
      id: 'bolt',
      castTimeMs: 0,
      gcdMs: 0,
      cooldownMs: 0,
      rangeYd: 5,
      usableWhileMoving: false,
      target: 'unit' as const,
      travelSpeedYdPerSec: 10,
      effects: [{ type: 'damage' as const, school: 'nature' as const, min: 1, max: 1 }],
    };
    const arrives = newSim();
    arrives.catalog.addSpell(bolt);
    arrives.at(0, EventClass.Decision, () => void startCast(arrives, 'boss', 'bolt', 'r2', [], { triggered: true }));
    arrives.run();
    const ok = arrives.trace.list().find((e) => e.kind === 'cast_success');
    const hit = arrives.trace.list().find((e) => e.kind === 'spell_hit' && e.data.spell === 'bolt');
    expect(ok?.t).toBe(0);
    expect(hit?.t).toBeGreaterThan(0);

    const dies = newSim();
    dies.catalog.addSpell(bolt);
    dies.at(0, EventClass.Decision, () => void startCast(dies, 'boss', 'bolt', 'r2', [], { triggered: true }));
    dies.at(10, EventClass.Decision, () => void kill(dies, 'r2'));
    dies.run();
    expect(dies.trace.list().some((e) => e.kind === 'cast_success')).toBe(true);
    expect(dies.trace.list().some((e) => e.kind === 'spell_hit' && e.data.spell === 'bolt')).toBe(false);
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

  const sel = (sim: Simulation, mechanic: string, o?: Parameters<ReturnType<typeof makeBossContext>['selectTarget']>[1]) =>
    makeBossContext(sim, 'boss').selectTarget(mechanic, o);
  const killUnit = (sim: Simulation, id: string) => sim.damage(id, 1e9, { sourceId: 'boss', ability: 'x', school: 'nature' }, []);

  it('minDistanceYd is inclusive and maxDistanceYd strict, on centre distance against the bound plus both reaches (A-021)', () => {
    const sim = newSim();
    const ctx = makeBossContext(sim, 'boss');
    // t1: centre distance 10 = 0.5 + 8 (boss reach) + 1.5 (player reach).
    expect(ctx.countTargets({ minDistanceYd: 0.5 })).toBe(5);
    expect(ctx.countTargets({ minDistanceYd: 0.501 })).toBe(4);
    expect(ctx.countTargets({ maxDistanceYd: 0.5 })).toBe(0);
    expect(ctx.countTargets({ maxDistanceYd: 0.501 })).toBe(1);
    expect(sel(sim, 'c', { minDistanceYd: 0.5, maxDistanceYd: 0.5 })).toBeNull();
    expect(sel(sim, 'd', { minDistanceYd: 0.5, maxDistanceYd: 0.501 })?.id).toBe('t1');
  });

  it('countTargets counts like selectTarget and draws no random numbers', () => {
    const sim = newSim();
    const ctx = makeBossContext(sim, 'boss');
    // Festergut's Vile Gas rule: edge distance >= 5, i.e. centre >= 14.5 here: h1 (25), r1 (30), r2 (35).
    expect(ctx.countTargets({ minDistanceYd: 5 })).toBe(3);
    expect(ctx.countTargets({ excludeVictim: true })).toBe(4);
    expect(Object.keys(sim.rng.usage()).filter((s) => s.startsWith('boss:'))).toEqual([]);
  });

  it('playersOnly keeps players (the threat list holds only players today)', () => {
    const sim = newSim();
    const ctx = makeBossContext(sim, 'boss');
    expect(ctx.countTargets({ playersOnly: true })).toBe(5);
    for (let i = 0; i < 10; i++) expect(ctx.selectTarget('x', { playersOnly: true, minDistanceYd: 5 })?.kind).toBe('player');
  });

  it('drops dead units from the candidates', () => {
    const sim = newSim();
    for (const id of ['h1', 'r1', 'r2']) killUnit(sim, id);
    for (let i = 0; i < 20; i++) expect(['m1', 't1']).toContain(sel(sim, 'x')?.id);
  });

  it('gives each mechanic name its own stream', () => {
    const alone = newSim();
    const a = Array.from({ length: 8 }, () => sel(alone, 'a')?.id);
    // Interleaving draws from another mechanic does not change the sequence of mechanic 'a'.
    const sim = newSim();
    const mixed = Array.from({ length: 8 }, () => {
      const id = sel(sim, 'a')?.id;
      sel(sim, 'other');
      return id;
    });
    expect(mixed).toEqual(a);
  });

  it('supports maxDistanceYd alone', () => {
    const sim = newSim();
    for (let i = 0; i < 20; i++) expect(['t1', 'm1']).toContain(sel(sim, 'x', { maxDistanceYd: 12 })?.id);
  });

  it('returns null when excluding the victim leaves nobody', () => {
    const sim = newSim();
    for (const id of ['m1', 'r1', 'r2', 'h1']) killUnit(sim, id);
    expect(sel(sim, 'x', { excludeVictim: true })).toBeNull();
    expect(sel(sim, 'x')?.id).toBe('t1');
  });

  it('rejects non-finite or negative distance bounds', () => {
    const sim = newSim();
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(() => sel(sim, 'x', { minDistanceYd: bad })).toThrow(/invalid distance bound/);
      expect(() => sel(sim, 'x', { maxDistanceYd: bad })).toThrow(/invalid distance bound/);
    }
  });

  it('returns an empty list and null without a threat manager', () => {
    const sim = new Simulation({ seed: 9, maxDurationMs: 5000, sampleIntervalMs: 1000 });
    sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', pos: { x: 0, y: 0 } });
    const ctx = makeBossContext(sim, 'boss');
    expect(ctx.threatList()).toEqual([]);
    expect(ctx.selectTarget('x', { excludeVictim: true })).toBeNull();
    expect(ctx.selectTarget('x')).toBeNull();
  });
});
