import { DataRegistry, PINS } from '@raid/data';
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import type { BossScript } from '../src/boss';
import { collectLimitations } from '../src/limitations';
import { evaluateObservations, type CustomCheck } from '../src/observations';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { buildSummary } from '../src/summary';

function fight() {
  const sim = new Simulation({ seed: 8, maxDurationMs: 10000, sampleIntervalMs: 1000 });
  const body = { speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389, pos: { x: 0, y: 0 } };
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1000000 });
  sim.addUnit({ ...body, id: 'p1', name: 'Alice', kind: 'player', role: 'ranged', maxHealth: 250, approximate: true });
  sim.addUnit({ ...body, id: 'p2', name: 'Bob', kind: 'player', role: 'healer', maxHealth: 1000 });
  sim.catalog.addAura({
    id: 'rot',
    durationMs: 5000,
    maxStacks: 5,
    periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'nature', min: 100, max: 100 }] },
  });
  sim.at(0, EventClass.SpellHit, () => {
    applyAura(sim, 'rot', 'boss', 'p1', []);
    applyAura(sim, 'rot', 'boss', 'p1', []);
  });
  sim.at(500, EventClass.SpellHit, () => void sim.heal('p1', 80, { sourceId: 'p2', ability: 'mend', school: 'holy' }, []));
  sim.run();
  const trace = sim.trace.build({
    engineVersion: 'test',
    azerothcoreCommit: PINS.azerothcoreCommit,
    spellDataVersions: [],
    scenario: 's',
    plan: 'p',
    maxDurationMs: 1000,
    mistakes: [],
    boss: 'boss',
    difficulty: '25n',
    seed: 8,
    profile: 'azerothcore',
    aiUpdateIntervalMs: 10,
    sampleIntervalMs: 1000,
    units: sim.sortedUnits().map((u) => ({ id: u.id, name: u.name, kind: u.kind, role: u.role, approximate: u.approximate })),
  });
  return { sim, trace };
}

const script: BossScript = {
  bossId: 'boss',
  mechanics: [
    { key: 'boss.rot', status: 'implemented', omissions: [], validation: 'azerothcore_source' },
    { key: 'boss.cleave', status: 'partial', omissions: ['arc not modelled'], validation: 'unvalidated' },
  ],
  knownServerDifferences: ['example difference'],
  onEngage: () => {},
  updateAI: () => {},
};

describe('summary (§9)', () => {
  it('records deaths with the killing blow and the causal chain', () => {
    const { trace } = fight();
    const s = buildSummary(trace, collectLimitations(fight().sim, new DataRegistry([]), []), []);
    expect(s.outcome).toBe('timeout');
    expect(s.durationMs).toBe(10000);
    expect(s.deaths).toHaveLength(1);
    const d = s.deaths[0];
    expect(d).toMatchObject({ unit: 'p1', atMs: 3000, killingBlow: { ability: 'rot', source: 'boss', amount: 50, overkill: 50 } });
    expect(d.chain.map((id) => trace.events.find((e) => e.id === id)!.kind)).toEqual(['damage', 'periodic_tick', 'aura_applied']);
  });

  it('totals damage, healing and overhealing, and the highest stacks', () => {
    const { sim, trace } = fight();
    const s = buildSummary(trace, collectLimitations(sim, new DataRegistry([]), []), []);
    expect(s.units.boss.damageDone).toBe(250);
    expect(s.units.p1.damageTaken).toBe(250);
    expect(s.units.p2).toMatchObject({ healingDone: 0, overhealing: 80 });
    expect(s.maxStacks.rot).toEqual({ unit: 'p1', stacks: 2 });
  });
});

describe('observations (§10.3)', () => {
  it('evaluates built-in and custom checks', () => {
    const { trace } = fight();
    const deaths: CustomCheck = ({ trace: t, params }) => {
      const n = t.events.filter((e) => e.kind === 'death').length;
      return { pass: n === params.expected, detail: `${n} deaths` };
    };
    const results = evaluateObservations(
      [
        { check: 'outcome_is', outcome: 'timeout' },
        { check: 'event_occurs', kind: 'death', where: { unit: 'p1' } },
        { check: 'event_absent', kind: 'death', where: { unit: 'p2' } },
        { check: 'custom', name: 'count.deaths', params: { expected: 1 } },
        { check: 'custom', name: 'missing', params: {} },
      ],
      trace,
      new Map([['count.deaths', deaths]]),
    );
    expect(results.map((r) => r.pass)).toEqual([true, true, true, true, false]);
    expect(results[4].detail).toBe('unknown custom check');
  });
});

describe('limitations (§6.4)', () => {
  it('lists stand-ins, used assumptions, partial mechanics and known differences', () => {
    const { sim } = fight();
    const data = new DataRegistry([
      { key: 'a.used', value: 1, source: { kind: 'assumption', rationale: 'r1', confirmBy: 'c1' } },
      { key: 'a.unused', value: 1, source: { kind: 'assumption', rationale: 'r2', confirmBy: 'c2' } },
      { key: 'c.used', value: 1, source: { kind: 'configured', file: 'f' } },
    ]);
    data.get('a.used');
    data.get('c.used');
    const l = collectLimitations(sim, data, [script]);
    expect(l.standIns).toEqual(['p1']);
    expect(l.assumptions).toEqual([{ key: 'a.used', rationale: 'r1', confirmBy: 'c1' }]);
    expect(l.partialMechanics).toEqual([{ boss: 'boss', key: 'boss.cleave', status: 'partial', omissions: ['arc not modelled'] }]);
    expect(l.knownServerDifferences).toEqual(['example difference']);
    expect(l.unappliedOverrides).toEqual([]);
  });

  it('reports failing built-in checks', () => {
    const { trace } = fight();
    const results = evaluateObservations(
      [
        { check: 'outcome_is', outcome: 'kill' },
        { check: 'event_occurs', kind: 'death', where: { unit: 'p2' } },
        { check: 'event_absent', kind: 'death', where: { unit: 'p1' } },
      ],
      trace,
      new Map(),
    );
    expect(results.map((r) => r.pass)).toEqual([false, false, false]);
    expect(results[0].detail).toBe('expected kill, got timeout');
    expect(results[1].detail).toBe('0 matching events');
    expect(results[2].detail).toBe('1 matching events');
  });

  it('a throwing custom check fails instead of aborting', () => {
    const { trace } = fight();
    const boom: CustomCheck = () => {
      throw new Error('kaboom');
    };
    const results = evaluateObservations([{ check: 'custom', name: 'boom', params: {} }], trace, new Map([['boom', boom]]));
    expect(results).toEqual([{ check: 'custom:boom', pass: false, detail: 'check threw: kaboom' }]);
  });
});
