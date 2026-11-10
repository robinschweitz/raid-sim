import { describe, expect, it } from 'vitest';
import { applyMistakes } from '../src/plan/mistakes';
import { RuleEngine, BUILTIN_ACTIONS } from '../src/rules';
import { Simulation } from '../src/sim';
import { parsePlan, parseScenario, prepareRun } from '../src/plan/prepare';

const PLAN = `
id: test-plan
boss: dummy
roster:
  - { id: t1, name: Tank, kind: standin, role: tank, maxHealth: 40000, ratePerSecond: 500, reaction: { minMs: 300, maxMs: 300 } }
  - { id: p1, name: Alice, kind: modelled, spec: test_caster, profile: default, reaction: { minMs: 300, maxMs: 500 } }
  - { id: p2, name: Bob, kind: modelled, spec: test_caster, profile: default, reaction: { minMs: 300, maxMs: 500 } }
spots:
  tank: { x: 6, y: 0 }
  ranged: { x: 20, y: 0 }
  far: { x: 50, y: 0 }
phases:
  - phase: default
    assignments: { t1: tank, p1: ranged, p2: ranged }
rules:
  - id: run
    who: [p1, p2]
    when: { on: aura_applied, aura: mark, target: self }
    do: { do: move_to, spot: far }
  - id: swap
    who: [p1]
    when: { on: aura_stacks, aura: bloat, target: current_tank, atLeast: 9 }
    do: { do: taunt, target: boss }
    priority: 90
`;

const SCENARIO = `
id: test-scenario
plan: test-plan.yaml
difficulty: 25n
seed: 1
maxDurationMs: 60000
mistakes:
  - { type: exclude_from_rule, rule: run, player: p2 }
  - { type: set_stack_threshold, rule: swap, atLeast: 12 }
  - { type: reaction, player: p1, minMs: 1000, maxMs: 1500 }
observation:
  text: scenario.test.observation
  checks:
    - { check: outcome_is, outcome: timeout }
`;

function parsed() {
  const plan = parsePlan('plan.yaml', PLAN);
  const scenario = parseScenario('scenario.yaml', SCENARIO);
  if (!plan.ok || !scenario.ok) throw new Error('fixture must parse');
  return { plan: plan.value, scenario: scenario.value };
}

describe('plan and scenario parsing', () => {
  it('applies defaults', () => {
    const { plan, scenario } = parsed();
    expect(plan.rules[0]).toMatchObject({ priority: 50, mode: 'edge', cooldownMs: 0 });
    expect(scenario.profile).toBe('azerothcore');
    expect(scenario.annotations).toEqual([]);
  });

  it('reports YAML syntax errors with the file', () => {
    const r = parsePlan('broken.yaml', 'id: [unclosed');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toMatchObject({ file: 'broken.yaml', path: '(yaml)' });
  });

  it('reports schema errors with their path', () => {
    const r = parsePlan('plan.yaml', PLAN.replace('id: t1,', 'id: T1,'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((p) => p.path)).toContain('roster.0.id');
  });

  it('rejects unknown trigger kinds', () => {
    const r = parsePlan('plan.yaml', PLAN.replace('on: aura_applied', 'on: aura_maybe'));
    expect(r.ok).toBe(false);
  });
});

describe('finite numbers', () => {
  it('rejects infinite positions and rates', () => {
    expect(parsePlan('plan.yaml', PLAN.replace('far: { x: 50, y: 0 }', 'far: { x: .inf, y: 0 }')).ok).toBe(false);
    expect(parsePlan('plan.yaml', PLAN.replace('ratePerSecond: 500', 'ratePerSecond: .inf')).ok).toBe(false);
  });

  it('rejects an infinite health percentage', () => {
    const rule = ['  - id: low', '    who: [p1]', '    when: { on: health_below, target: self, pct: .inf }', '    do: { do: stop_casting }', ''].join(String.fromCharCode(10));
    expect(parsePlan('plan.yaml', PLAN + rule).ok).toBe(false);
  });
});

describe('cross validation', () => {
  it('rejects duplicate members within a rule', () => {
    const { plan, scenario } = parsed();
    const bad = structuredClone(plan);
    bad.rules[0].who = ['p1', 'p1'];
    const r = prepareRun({ plan: bad, planFile: 'plan.yaml', scenario, scenarioFile: 'scenario.yaml' });
    expect(r.ok ? [] : r.problems.map((p) => p.message)).toContain('duplicate member p1 in rule run');
  });

  it('accepts a consistent plan and scenario', () => {
    const { plan, scenario } = parsed();
    expect(prepareRun({ plan, planFile: 'plan.yaml', scenario, scenarioFile: 'scenario.yaml' }).ok).toBe(true);
  });

  it('finds broken references', () => {
    const { plan, scenario } = parsed();
    const badPlan = structuredClone(plan);
    badPlan.phases[0].assignments.p1 = 'nowhere';
    delete badPlan.phases[0].assignments.p2;
    badPlan.rules[0].who.push('ghost');
    const badScenario = structuredClone(scenario);
    badScenario.mistakes.push({ type: 'disable_rule', rule: 'nope' });
    badScenario.mistakes.push({ type: 'exclude_from_rule', rule: 'swap', player: 'p2' });
    badScenario.mistakes.push({ type: 'set_stack_threshold', rule: 'run', atLeast: 3 });
    badScenario.mistakes.push({ type: 'reaction', player: 'p1', minMs: 900, maxMs: 100 });
    const r = prepareRun({ plan: badPlan, planFile: 'plan.yaml', scenario: badScenario, scenarioFile: 'scenario.yaml' });
    expect(r.ok).toBe(false);
    const messages = r.ok ? [] : r.problems.map((p) => p.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'unknown spot nowhere',
        'p2 has no assignment in phase default',
        'unknown roster id ghost',
        'unknown rule nope',
        'p2 is not in rule swap',
        'rule run has no aura_stacks trigger',
        'minMs must not exceed maxMs',
      ]),
    );
  });

  it('rejects reserved ids in the roster', () => {
    const r = parsePlan('plan.yaml', PLAN.replace('id: p2,', 'id: boss,').replace('p2: ranged', 'boss: ranged').replace('[p1, p2]', '[p1, boss]'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { scenario } = parsed();
    scenario.mistakes = [];
    const prepared = prepareRun({ plan: r.value, planFile: 'plan.yaml', scenario, scenarioFile: 's.yaml' });
    expect(prepared.ok ? [] : prepared.problems.map((p) => p.message)).toContain('boss is reserved');
  });
});

describe('mistakes', () => {
  it('produces the effective plan without changing the base plan', () => {
    const { plan, scenario } = parsed();
    const before = JSON.stringify(plan);
    const effective = applyMistakes(plan, scenario.mistakes);
    expect(JSON.stringify(plan)).toBe(before);
    expect(effective.rules.find((r) => r.id === 'run')?.who).toEqual(['p1']);
    const swap = effective.rules.find((r) => r.id === 'swap')!;
    expect(swap.when).toMatchObject({ on: 'aura_stacks', atLeast: 12 });
    expect(effective.roster.find((m) => m.id === 'p1')?.reaction).toEqual({ minMs: 1000, maxMs: 1500 });
  });

  it('disable_rule removes the rule', () => {
    const { plan } = parsed();
    expect(applyMistakes(plan, [{ type: 'disable_rule', rule: 'swap' }]).rules.map((r) => r.id)).toEqual(['run']);
  });

  it('drops rules whose who became empty', () => {
    const { plan } = parsed();
    const effective = applyMistakes(plan, [
      { type: 'exclude_from_rule', rule: 'swap', player: 'p1' },
      { type: 'exclude_from_rule', rule: 'run', player: 'p1' },
    ]);
    expect(effective.rules.map((r) => r.id)).toEqual(['run']);
    expect(effective.rules[0].who).toEqual(['p2']);
    expect(applyMistakes(plan, [{ type: 'exclude_from_rule', rule: 'swap', player: 'p1' }]).rules.map((r) => r.id)).toEqual(['run']);
  });

  it('prepareRun returns base and effective plans', () => {
    const { plan, scenario } = parsed();
    const r = prepareRun({ plan, planFile: 'plan.yaml', scenario, scenarioFile: 'scenario.yaml' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.basePlan.rules.find((x) => x.id === 'run')?.who).toEqual(['p1', 'p2']);
    expect(r.value.plan.rules.find((x) => x.id === 'run')?.who).toEqual(['p1']);
  });
});

describe('phase assignments', () => {
  it('an actor missing from a non-default phase falls back to its default assignment', () => {
    const { plan } = parsed();
    plan.phases.push({ phase: 'two', assignments: { t1: 'far' } });
    const sim = new Simulation({ seed: 1, maxDurationMs: 1000, sampleIntervalMs: 1000 });
    const engine = new RuleEngine(sim, plan, BUILTIN_ACTIONS, { currentTank: () => null });
    sim.phase = 'two';
    expect(engine.assignment('t1')).toBe('far');
    expect(engine.assignment('p1')).toBe('ranged');
  });
});
