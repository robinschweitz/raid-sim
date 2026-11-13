import { readFileSync } from 'node:fs';
import { parsePlan, parseScenario, prepareRun, runScenario, type Summary, type Trace, type TraceEvent } from '@raid/engine';
import { CONTENT } from '../../src/index';

const DIR = 'scenarios/festergut';

export interface ScenarioRun {
  readonly trace: Trace;
  readonly summary: Summary;
  events(kind: TraceEvent['kind'], where?: Readonly<Record<string, unknown>>): TraceEvent[];
}

/** Runs `scenarios/festergut/<name>.yaml` with its plan, as the CLI does. */
export function runFestergutScenario(name: string): ScenarioRun {
  const scenarioFile = `${DIR}/${name}.yaml`;
  const scenario = parseScenario(scenarioFile, readFileSync(scenarioFile, 'utf8'));
  if (!scenario.ok) throw new Error(JSON.stringify(scenario.problems));
  const planFile = `${DIR}/${scenario.value.plan}`;
  const plan = parsePlan(planFile, readFileSync(planFile, 'utf8'));
  if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
  const prepared = prepareRun({ plan: plan.value, planFile, scenario: scenario.value, scenarioFile });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.problems));
  const r = runScenario(prepared.value, CONTENT);
  if (r.outcome === 'invalid') throw new Error(JSON.stringify(r.problems));
  const { trace, summary } = r;
  return {
    trace,
    summary,
    events: (kind, where = {}) => trace.events.filter((e) => e.kind === kind && Object.entries(where).every(([k, v]) => e.data[k] === v)),
  };
}

/** The text keys a scenario file uses (its observation and its annotations). */
export function scenarioTextKeys(name: string): string[] {
  const scenario = parseScenario(name, readFileSync(`${DIR}/${name}.yaml`, 'utf8'));
  if (!scenario.ok) throw new Error(JSON.stringify(scenario.problems));
  return [scenario.value.observation.text, ...scenario.value.annotations.map((a) => a.text)];
}
