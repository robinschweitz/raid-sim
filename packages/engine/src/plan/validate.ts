import { RESERVED_REFS, type Plan, type Rule, type Scenario } from './schema';

export interface LoadProblem {
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

export function crossValidate(plan: Plan, planFile: string, scenario: Scenario | null, scenarioFile: string): LoadProblem[] {
  const out: LoadProblem[] = [];
  const inPlan = (path: string, message: string) => out.push({ file: planFile, path, message });
  const inScenario = (path: string, message: string) => out.push({ file: scenarioFile, path, message });

  const roster = new Set<string>();
  plan.roster.forEach((m, i) => {
    if (roster.has(m.id)) inPlan(`roster.${i}.id`, `duplicate roster id ${m.id}`);
    if (RESERVED_REFS.includes(m.id)) inPlan(`roster.${i}.id`, `${m.id} is reserved`);
    if (m.reaction.minMs > m.reaction.maxMs) inPlan(`roster.${i}.reaction`, 'minMs must not exceed maxMs');
    roster.add(m.id);
  });
  const ref = (path: string, r: string) => {
    if (!RESERVED_REFS.includes(r) && !roster.has(r)) inPlan(path, `unknown unit ${r}`);
  };

  const spots = new Set(Object.keys(plan.spots));
  const phases = new Set<string>();
  plan.phases.forEach((ph, i) => {
    if (phases.has(ph.phase)) inPlan(`phases.${i}.phase`, `duplicate phase ${ph.phase}`);
    phases.add(ph.phase);
    for (const [who, spot] of Object.entries(ph.assignments)) {
      if (!roster.has(who)) inPlan(`phases.${i}.assignments.${who}`, `unknown roster id ${who}`);
      if (!spots.has(spot)) inPlan(`phases.${i}.assignments.${who}`, `unknown spot ${spot}`);
    }
  });
  const def = plan.phases.find((p) => p.phase === 'default');
  if (!def) inPlan('phases', 'a phase named default is required');
  else for (const m of plan.roster) if (!(m.id in def.assignments)) inPlan('phases', `${m.id} has no assignment in phase default`);

  const rules = new Map<string, Rule>();
  plan.rules.forEach((r, i) => {
    if (rules.has(r.id)) inPlan(`rules.${i}.id`, `duplicate rule id ${r.id}`);
    rules.set(r.id, r);
    r.who.forEach((w, j) => {
      if (!roster.has(w)) inPlan(`rules.${i}.who.${j}`, `unknown roster id ${w}`);
    });
    const w = r.when;
    if (w.on === 'aura_applied' || w.on === 'aura_stacks' || w.on === 'health_below') ref(`rules.${i}.when.target`, w.target);
    if (w.on === 'cast_start') ref(`rules.${i}.when.caster`, w.caster);
    const a = r.do;
    if (a.do === 'move_to' && !spots.has(a.spot)) inPlan(`rules.${i}.do.spot`, `unknown spot ${a.spot}`);
    if (a.do === 'taunt') ref(`rules.${i}.do.target`, a.target);
    if (a.do === 'use_cooldown' && a.target !== undefined) ref(`rules.${i}.do.target`, a.target);
  });

  scenario?.mistakes.forEach((mk, i) => {
    const path = `mistakes.${i}`;
    if (mk.type === 'reaction') {
      if (!roster.has(mk.player)) inScenario(`${path}.player`, `unknown roster id ${mk.player}`);
      if (mk.minMs > mk.maxMs) inScenario(path, 'minMs must not exceed maxMs');
      return;
    }
    const rule = rules.get(mk.rule);
    if (!rule) {
      inScenario(`${path}.rule`, `unknown rule ${mk.rule}`);
      return;
    }
    if (mk.type === 'exclude_from_rule' && !rule.who.includes(mk.player)) {
      inScenario(`${path}.player`, `${mk.player} is not in rule ${mk.rule}`);
    }
    if (mk.type === 'set_stack_threshold' && rule.when.on !== 'aura_stacks') {
      inScenario(`${path}.rule`, `rule ${mk.rule} has no aura_stacks trigger`);
    }
  });
  return out;
}
