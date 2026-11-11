import { readFileSync } from 'node:fs';
import { parsePlan, parseScenario, prepareRun, runScenario } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/index';

function run() {
  const plan = parsePlan('plan.yaml', readFileSync('scenarios/training-dummy/plan.yaml', 'utf8'));
  const scenario = parseScenario('clean.yaml', readFileSync('scenarios/training-dummy/clean.yaml', 'utf8'));
  if (!plan.ok || !scenario.ok) throw new Error('scenario files must parse');
  const prepared = prepareRun({ plan: plan.value, planFile: 'plan.yaml', scenario: scenario.value, scenarioFile: 'clean.yaml' });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.problems));
  return runScenario(prepared.value, CONTENT);
}

describe('training dummy', () => {
  it('is killed with every observation passing', () => {
    const r = run();
    if (r.outcome === 'invalid') throw new Error(JSON.stringify(r.problems));
    expect(r.outcome).toBe('kill');
    expect(r.summary.observations.every((o) => o.pass)).toBe(true);
    const kinds = new Set(r.trace.events.map((e) => e.kind));
    for (const k of ['threat_target', 'aura_applied', 'move_start', 'heal'] as const) expect(kinds.has(k), k).toBe(true);
    expect(r.trace.events.some((e) => e.kind === 'damage' && e.data.ability === 'melee')).toBe(true);
  });
});
