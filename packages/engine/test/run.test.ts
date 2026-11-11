import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parsePlan, parseScenario, prepareRun, type PreparedRun } from '../src/plan/prepare';
import type { Mistake } from '../src/plan/schema';
import { runScenario, type ContentRegistry } from '../src/run';
import { canonicalStringify, type TraceValue } from '../src/trace';
import { dummyBoss } from './fixtures/dummy-boss';
import { PLAN_YAML, SCENARIO_YAML } from './fixtures/dummy-plan';
import { testCaster } from './fixtures/test-caster';

const registry: ContentRegistry = {
  bosses: new Map([['dummy', dummyBoss]]),
  policies: new Map([['test_caster', testCaster]]),
  actions: new Map(),
  checks: new Map(),
};

function prepared(mistakes: Mistake[] = [], planYaml = PLAN_YAML, scenarioYaml = SCENARIO_YAML): PreparedRun {
  const plan = parsePlan('dummy-plan.yaml', planYaml);
  const scenario = parseScenario('dummy-scenario.yaml', scenarioYaml);
  if (!plan.ok || !scenario.ok) throw new Error(JSON.stringify([plan, scenario]));
  const r = prepareRun({ plan: plan.value, planFile: 'dummy-plan.yaml', scenario: { ...scenario.value, mistakes }, scenarioFile: 'dummy-scenario.yaml' });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.value;
}

function run(p: PreparedRun) {
  const r = runScenario(p, registry);
  if (r.outcome === 'invalid') throw new Error(JSON.stringify(r.problems));
  return r;
}

interface Pick {
  readonly t: number;
  readonly eligible: TraceValue | undefined;
  readonly picked: TraceValue | undefined;
}

function picks(r: ReturnType<typeof run>): Pick[] {
  return r.trace.events
    .filter((e) => e.kind === 'ai_event' && e.data.event === 'mark')
    .map((e) => ({ t: e.t, eligible: e.data.eligible, picked: e.data.picked }));
}

describe('runScenario', () => {
  it('runs the dummy scenario with observations and a limitation report', () => {
    const r = run(prepared());
    expect(r.outcome).toBe('timeout');
    expect(r.trace.events[0].kind).toBe('engage');
    expect(r.summary.observations.map((o) => o.pass)).toEqual([true, true]);
    expect(r.summary.limitations.standIns).toEqual(['h1', 'p3', 't1']);
    expect(r.summary.limitations.assumptions.map((a) => a.key)).toEqual([
      'core.ai_update_interval_ms',
      'core.sample_interval_ms',
      'core.standin_range_healer_yd',
      'core.standin_range_melee_yd',
      'core.standin_range_ranged_yd',
      'core.standin_range_tank_yd',
      'core.standin_tick_ms',
      'dummy.guess',
    ]);
    expect(r.summary.limitations.partialMechanics.map((m) => m.key)).toEqual(['dummy.cleave']);
    expect(picks(r).map((p) => p.t)).toEqual([12000, 24000]);
    expect(r.trace.meta.units.find((u) => u.id === 'p3')?.approximate).toBe(true);
  });

  it('is deterministic: same scenario and seed give byte-identical output (§11)', () => {
    const a = run(prepared());
    const b = run(prepared());
    expect(canonicalStringify(a.trace)).toBe(canonicalStringify(b.trace));
    expect(canonicalStringify(a.summary)).toBe(canonicalStringify(b.summary));
  });

  it('keeps boss selections while the eligible sets are equal (§8.7)', () => {
    const cleanRun = run(prepared());
    const slowRun = run(prepared([{ type: 'reaction', player: 'p3', minMs: 900, maxMs: 1500 }]));
    // The mistake really changed the run, so equal picks are not trivially equal runs.
    expect(canonicalStringify(slowRun.trace)).not.toBe(canonicalStringify(cleanRun.trace));
    const clean = picks(cleanRun);
    const slow = picks(slowRun);
    expect(slow).toHaveLength(clean.length);
    expect(slow[0].eligible).toEqual(clean[0].eligible);
    let compared = 0;
    clean.forEach((c, i) => {
      if (canonicalStringify(c.eligible) === canonicalStringify(slow[i].eligible)) {
        compared++;
        expect(slow[i].picked).toEqual(c.picked);
      }
    });
    expect(compared).toBeGreaterThanOrEqual(1);
  });

  it('a mistake that changes eligibility may legitimately change later selections', () => {
    const clean = picks(run(prepared()));
    const ruleMembers = ['p1', 'p2', 'p3', 'h1'];
    const runner = (clean[0].picked as readonly string[]).find((id) => ruleMembers.includes(id))!;
    const stay = picks(run(prepared([{ type: 'exclude_from_rule', rule: 'run-when-marked', player: runner }])));
    expect(stay[0]).toEqual(clean[0]);
    expect(clean[1].eligible).not.toContain(runner);
    expect(stay[1].eligible).toContain(runner);
  });

  it('returns invalid for an action without a handler or a spec without a model', () => {
    const withTaunt = `${PLAN_YAML}  - id: swap
    who: [p1]
    when: { on: time, atMs: 1000 }
    do: { do: use_cooldown, spell: test_bolt }
`;
    const r = runScenario(prepared([], withTaunt), registry);
    expect(r.outcome).toBe('invalid');
    if (r.outcome === 'invalid') expect(r.problems.map((p) => p.message)).toContain('no handler for action use_cooldown');
    const noSpec = runScenario(prepared(), { ...registry, policies: new Map() });
    expect(noSpec.outcome).toBe('invalid');
    if (noSpec.outcome === 'invalid') expect(noSpec.problems.map((p) => p.message)).toContain('no model for spec test_caster');
  });

  it('reports rule references to auras or spells the content does not define', () => {
    const typo = PLAN_YAML.replace('aura: mark, target: self', 'aura: mrak, target: self');
    const r = runScenario(prepared([], typo), registry);
    expect(r.outcome).toBe('invalid');
    if (r.outcome === 'invalid') {
      expect(r.problems).toEqual([{ file: 'dummy-plan.yaml', path: 'rules.0.when.aura', message: 'unknown aura mrak' }]);
    }
  });

  it('results do not depend on roster or rule `who` list order (§8.7)', () => {
    const base = prepared();
    const reversed: PreparedRun = {
      ...base,
      plan: {
        ...base.plan,
        roster: [...base.plan.roster].reverse(),
        rules: base.plan.rules.map((r) => ({ ...r, who: [...r.who].reverse() })),
      },
    };
    expect(reversed.plan.roster.map((m) => m.id)).not.toEqual(base.plan.roster.map((m) => m.id));
    expect(canonicalStringify(run(reversed).trace)).toBe(canonicalStringify(run(base).trace));
  });

  it('records plan, maxDurationMs and mistakes in the trace meta', () => {
    const clean = run(prepared());
    const mistake: Mistake = { type: 'reaction', player: 'p3', minMs: 900, maxMs: 1500 };
    const slow = run(prepared([mistake]));
    expect(clean.trace.meta).toMatchObject({ plan: 'dummy-basic', maxDurationMs: 30000, mistakes: [] });
    expect(slow.trace.meta.mistakes).toEqual([canonicalStringify(mistake)]);
    expect(canonicalStringify(clean.trace.meta)).not.toBe(canonicalStringify(slow.trace.meta));
  });

  it('pins the dummy clean trace (regression pin: update deliberately when the engine output changes)', () => {
    const hash = createHash('sha256').update(canonicalStringify(run(prepared()).trace)).digest('hex');
    expect(hash).toBe('4251d809e59f4669069443b701f583958140ca2415545b74056079e547209461');
  });

  describe('bad content is reported as invalid, not thrown', () => {
    const invalid = (p: PreparedRun, reg: ContentRegistry = registry) => {
      const r = runScenario(p, reg);
      if (r.outcome !== 'invalid') throw new Error(`expected invalid, got ${r.outcome}`);
      return r.problems;
    };

    it('unknown boss', () => {
      const problems = invalid(prepared(), { ...registry, bosses: new Map() });
      expect(problems).toEqual([{ file: 'dummy-plan.yaml', path: 'boss', message: 'unknown boss dummy' }]);
    });

    it('unknown custom check', () => {
      const scenario = `${SCENARIO_YAML}    - { check: custom, name: nope }\n`;
      const problems = invalid(prepared([], PLAN_YAML, scenario));
      expect(problems[0]).toMatchObject({ file: 'dummy-scenario.yaml', path: 'observation.checks.2.name' });
    });

    it('a boss setup that reads a missing data key', () => {
      const bad = { ...dummyBoss, setup: (a: Parameters<typeof dummyBoss.setup>[0]) => (a.data.num('dummy.missing'), dummyBoss.setup(a)) };
      const problems = invalid(prepared(), { ...registry, bosses: new Map([['dummy', bad]]) });
      expect(problems).toEqual([{ file: 'boss:dummy', path: '(setup)', message: 'unknown data key: dummy.missing' }]);
    });

    it('a model factory that throws is attributed to the spec', () => {
      const bad = { ...testCaster, create: () => { throw new Error('boom'); } };
      const problems = invalid(prepared(), { ...registry, policies: new Map([['test_caster', bad]]) });
      expect(problems[0]).toEqual({ file: 'spec:test_caster', path: '(setup)', message: 'boom' });
    });

    it('spec data entries are merged into the registry once per spec', () => {
      const withData = {
        ...testCaster,
        data: [{ key: 'test_caster.hp', value: 25000, source: { kind: 'configured', file: 'test' } }],
        create: (args: Parameters<typeof testCaster.create>[0]) => {
          const made = testCaster.create(args);
          return { ...made, unit: { ...made.unit, maxHealth: args.data.num('test_caster.hp') } };
        },
      };
      const r = runScenario(prepared(), { ...registry, policies: new Map([['test_caster', withData]]) });
      if (r.outcome === 'invalid') throw new Error(JSON.stringify(r.problems));
      expect(r.outcome).toBe('timeout');
      // Two modelled members use the spec: its entries must not be reported as duplicates.
      const dup = runScenario(prepared(), { ...registry, policies: new Map([['test_caster', { ...withData, data: [...withData.data, withData.data[0]] }]]) });
      expect(dup.outcome).toBe('invalid');
    });

    it('a boss data entry with a duplicate key', () => {
      const dup = { ...dummyBoss, data: [...dummyBoss.data, dummyBoss.data[0]] };
      const problems = invalid(prepared(), { ...registry, bosses: new Map([['dummy', dup]]) });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ file: 'boss:dummy', path: '(data)' });
      expect(problems[0].message).toContain('duplicate key dummy.pick_interval_ms');
    });

    it('a boss data entry that collides with a core key is the boss content\'s fault', () => {
      const clash = { ...dummyBoss, data: [...dummyBoss.data, { key: 'core.standin_tick_ms', value: 1, source: { kind: 'assumption', rationale: 'r', confirmBy: 'c' } }] };
      const problems = invalid(prepared(), { ...registry, bosses: new Map([['dummy', clash]]) });
      expect(problems[0]).toMatchObject({ file: 'boss:dummy', path: '(data)' });
    });
  });

  describe('kill set validation', () => {
    const withKill = (mustKill: readonly string[] | undefined): ContentRegistry => ({
      ...registry,
      bosses: new Map([['dummy', { ...dummyBoss, setup: (a) => ({ ...dummyBoss.setup(a), ...(mustKill === undefined ? {} : { mustKill }) }) }]]),
    });
    it('rejects a kill set naming an unknown unit', () => {
      const r = runScenario(prepared(), withKill(['dummy', 'ghost']));
      expect(r).toEqual({ outcome: 'invalid', problems: [{ file: 'boss:dummy', path: '(setup)', message: 'mustKill references unknown unit ghost' }] });
    });
    it('rejects an explicitly empty kill set', () => {
      const r = runScenario(prepared(), withKill([]));
      expect(r).toEqual({ outcome: 'invalid', problems: [{ file: 'boss:dummy', path: '(setup)', message: 'mustKill must not be empty' }] });
    });
  });
});
