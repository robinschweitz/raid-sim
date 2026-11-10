import { zodIssues } from '@raid/data';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { applyMistakes } from './mistakes';
import { PlanSchema, ScenarioSchema, type Plan, type Scenario } from './schema';
import { crossValidate, type LoadProblem } from './validate';

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problems: readonly LoadProblem[] };

export interface PreparedRun {
  readonly scenario: Scenario;
  readonly scenarioFile: string;
  /** The effective plan, with the scenario's mistakes applied. */
  readonly plan: Plan;
  readonly basePlan: Plan;
  readonly planFile: string;
}

function parseDocument<S extends z.ZodTypeAny>(file: string, text: string, schema: S): Parsed<z.infer<S>> {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    return { ok: false, problems: [{ file, path: '(yaml)', message: e instanceof Error ? e.message : String(e) }] };
  }
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, problems: zodIssues(r.error).map((i) => ({ file, path: i.path, message: i.message })) };
  return { ok: true, value: r.data };
}

export function parsePlan(file: string, text: string): Parsed<Plan> {
  return parseDocument(file, text, PlanSchema);
}

export function parseScenario(file: string, text: string): Parsed<Scenario> {
  return parseDocument(file, text, ScenarioSchema);
}

export function prepareRun(input: {
  readonly scenario: Scenario;
  readonly scenarioFile: string;
  readonly plan: Plan;
  readonly planFile: string;
}): Parsed<PreparedRun> {
  const problems = crossValidate(input.plan, input.planFile, input.scenario, input.scenarioFile);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      scenario: input.scenario,
      scenarioFile: input.scenarioFile,
      planFile: input.planFile,
      basePlan: input.plan,
      plan: applyMistakes(input.plan, input.scenario.mistakes),
    },
  };
}
