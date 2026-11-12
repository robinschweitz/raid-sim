import { describe, expect, it } from 'vitest';
import { parsePlan, parseScenario, prepareRun } from '../src/plan/prepare';
import { runScenario, type ContentRegistry, type PolicyFactory } from '../src/run';
import { dummyBoss } from './fixtures/dummy-boss';
import { PLAN_YAML, SCENARIO_YAML } from './fixtures/dummy-plan';
import { testCaster } from './fixtures/test-caster';

function run(caster: PolicyFactory) {
  const registry: ContentRegistry = { bosses: new Map([['dummy', dummyBoss]]), policies: new Map([['test_caster', caster]]), actions: new Map(), checks: new Map() };
  const plan = parsePlan('dummy-plan.yaml', PLAN_YAML);
  const scenario = parseScenario('dummy-scenario.yaml', SCENARIO_YAML);
  if (!plan.ok || !scenario.ok) throw new Error('fixtures must parse');
  const prepared = prepareRun({ plan: plan.value, planFile: 'dummy-plan.yaml', scenario: scenario.value, scenarioFile: 'dummy-scenario.yaml' });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.problems));
  const r = runScenario(prepared.value, registry);
  if (r.outcome === 'invalid') throw new Error(JSON.stringify(r.problems));
  return r;
}

describe('generic role actors are stand-ins (spec §6.3, A-035)', () => {
  it('a spec is not approximate by default', () => {
    const r = run(testCaster);
    expect(r.summary.limitations.standIns).toEqual(['h1', 'p3', 't1']);
    expect(r.trace.meta.units.find((u) => u.id === 'p1')?.approximate).toBe(false);
  });

  it('units of an approximate policy factory are marked and reported like rate stand-ins', () => {
    const r = run({ ...testCaster, approximate: true });
    expect(r.summary.limitations.standIns).toEqual(['h1', 'p1', 'p2', 'p3', 't1']);
    expect(r.trace.meta.units.filter((u) => u.kind === 'player').every((u) => u.approximate)).toBe(true);
    // They still act through the cast machinery.
    expect(r.trace.events.some((e) => e.kind === 'cast_success' && e.data.caster === 'p1' && e.data.spell === 'test_bolt')).toBe(true);
  });
});
