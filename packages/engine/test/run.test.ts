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

function prepared(mistakes: Mistake[] = [], planYaml = PLAN_YAML): PreparedRun {
  const plan = parsePlan('dummy-plan.yaml', planYaml);
  const scenario = parseScenario('dummy-scenario.yaml', SCENARIO_YAML);
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
    expect(r.summary.limitations.assumptions.map((a) => a.key)).toEqual(['core.ai_update_interval_ms', 'dummy.guess']);
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
    const clean = picks(run(prepared()));
    const slow = picks(run(prepared([{ type: 'reaction', player: 'p3', minMs: 900, maxMs: 1500 }])));
    expect(slow).toHaveLength(clean.length);
    expect(slow[0].eligible).toEqual(clean[0].eligible);
    clean.forEach((c, i) => {
      if (canonicalStringify(c.eligible) === canonicalStringify(slow[i].eligible)) expect(slow[i].picked).toEqual(c.picked);
    });
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
    do: { do: taunt, target: boss }
`;
    const r = runScenario(prepared([], withTaunt), registry);
    expect(r.outcome).toBe('invalid');
    if (r.outcome === 'invalid') expect(r.problems.map((p) => p.message)).toContain('no handler for action taunt');
    const noSpec = runScenario(prepared(), { ...registry, policies: new Map() });
    expect(noSpec.outcome).toBe('invalid');
    if (noSpec.outcome === 'invalid') expect(noSpec.problems.map((p) => p.message)).toContain('no model for spec test_caster');
  });
});
