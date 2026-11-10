import { DataRegistry, DataValidationError, PINS, type Difficulty } from '@raid/data';
import { attachBoss, victimOf, type BossScript } from './boss';
import { installCoreRules } from './casting';
import { ActorController, type ActorPolicy } from './controller';
import { CORE_DATA } from './core-data';
import { collectLimitations } from './limitations';
import { evaluateObservations, type CustomCheck } from './observations';
import type { PreparedRun } from './plan/prepare';
import type { ModelledMember } from './plan/schema';
import type { LoadProblem } from './plan/validate';
import { BUILTIN_ACTIONS, RuleEngine, type ActionHandler } from './rules';
import { Simulation, type OutcomeKind } from './sim';
import { installStandin } from './standin';
import { buildSummary, type Summary } from './summary';
import type { Trace } from './trace';
import type { Role, UnitInit } from './units';

export const ENGINE_VERSION = '0.1.0';

export interface PolicyFactory {
  readonly spec: string;
  readonly role: Exclude<Role, 'boss' | 'add'>;
  create(args: { readonly sim: Simulation; readonly member: ModelledMember; readonly data: DataRegistry }): {
    readonly unit: Pick<UnitInit, 'maxHealth' | 'speedYdPerSec' | 'combatReach' | 'boundingRadius'>;
    readonly policy: ActorPolicy;
  };
}

export interface BossSetup {
  readonly script: BossScript;
  readonly bossUnitId: string;
  /** Sets initial aggro once every player exists. */
  pull(sim: Simulation): void;
}

export interface BossModule {
  readonly id: string;
  readonly data: readonly unknown[];
  readonly overrides: readonly unknown[];
  setup(args: { readonly sim: Simulation; readonly data: DataRegistry; readonly difficulty: Difficulty }): BossSetup;
}

export interface ContentRegistry {
  readonly bosses: ReadonlyMap<string, BossModule>;
  readonly policies: ReadonlyMap<string, PolicyFactory>;
  readonly actions: ReadonlyMap<string, ActionHandler>;
  readonly checks: ReadonlyMap<string, CustomCheck>;
}

export type RunResult =
  | { readonly outcome: 'invalid'; readonly problems: readonly LoadProblem[] }
  | { readonly outcome: OutcomeKind; readonly trace: Trace; readonly summary: Summary };

function checkContent(p: PreparedRun, reg: ContentRegistry): LoadProblem[] {
  const problems: LoadProblem[] = [];
  if (!reg.bosses.has(p.plan.boss)) problems.push({ file: p.planFile, path: 'boss', message: `unknown boss ${p.plan.boss}` });
  p.plan.roster.forEach((m, i) => {
    if (m.kind === 'modelled' && !reg.policies.has(m.spec)) {
      problems.push({ file: p.planFile, path: `roster.${i}.spec`, message: `no model for spec ${m.spec}` });
    }
  });
  p.plan.rules.forEach((r, i) => {
    if (!BUILTIN_ACTIONS.has(r.do.do) && !reg.actions.has(r.do.do)) {
      problems.push({ file: p.planFile, path: `rules.${i}.do.do`, message: `no handler for action ${r.do.do}` });
    }
  });
  p.scenario.observation.checks.forEach((c, i) => {
    if (c.check === 'custom' && !reg.checks.has(c.name)) {
      problems.push({ file: p.scenarioFile, path: `observation.checks.${i}.name`, message: `unknown custom check ${c.name}` });
    }
  });
  return problems;
}

export function runScenario(prepared: PreparedRun, registry: ContentRegistry): RunResult {
  const problems = checkContent(prepared, registry);
  if (problems.length > 0) return { outcome: 'invalid', problems };
  const { scenario, plan } = prepared;
  const boss = registry.bosses.get(plan.boss)!;

  let data: DataRegistry;
  try {
    data = new DataRegistry([...CORE_DATA, ...boss.data], boss.overrides, scenario.profile);
  } catch (e) {
    if (e instanceof DataValidationError) {
      return { outcome: 'invalid', problems: e.problems.map((message) => ({ file: `boss:${boss.id}`, path: '(data)', message })) };
    }
    throw e;
  }

  const sim = new Simulation({
    seed: scenario.seed,
    maxDurationMs: scenario.maxDurationMs,
    sampleIntervalMs: data.num('core.sample_interval_ms'),
  });
  installCoreRules(sim);
  const setup = boss.setup({ sim, data, difficulty: scenario.difficulty });
  const rules = new RuleEngine(sim, plan, new Map([...BUILTIN_ACTIONS, ...registry.actions]), {
    currentTank: () => victimOf(sim, setup.bossUnitId),
  });
  const hooks = {
    isRuleMoving: (id: string) => rules.isMoving(id),
    spots: () => plan.spots,
    assignment: (id: string) => rules.assignment(id),
  };
  const playerBody = {
    speedYdPerSec: data.num('core.player_run_speed_yd_s'),
    combatReach: data.num('core.player_combat_reach_yd'),
    boundingRadius: data.num('core.player_bounding_radius_yd'),
  };

  const controllers: ActorController[] = [];
  for (const m of plan.roster) {
    const pos = plan.spots[rules.assignment(m.id)!];
    if (m.kind === 'modelled') {
      const factory = registry.policies.get(m.spec)!;
      const made = factory.create({ sim, member: m, data });
      sim.addUnit({ ...made.unit, id: m.id, name: m.name, kind: 'player', role: factory.role, pos });
      controllers.push(new ActorController(sim, m.id, made.policy, hooks));
    } else {
      sim.addUnit({ ...playerBody, id: m.id, name: m.name, kind: 'player', role: m.role, approximate: true, maxHealth: m.maxHealth, pos });
    }
  }
  setup.pull(sim);
  rules.install();
  for (const c of controllers) c.install();
  for (const m of plan.roster) if (m.kind === 'standin') installStandin(sim, m);
  const aiUpdateIntervalMs = data.num('core.ai_update_interval_ms');
  attachBoss(sim, setup.script, setup.bossUnitId, aiUpdateIntervalMs);
  const outcome = sim.run();

  const trace = sim.trace.build({
    engineVersion: ENGINE_VERSION,
    azerothcoreCommit: PINS.azerothcoreCommit,
    spellDataVersions: [...PINS.spellDataVersions],
    scenario: scenario.id,
    boss: plan.boss,
    difficulty: scenario.difficulty,
    seed: scenario.seed,
    profile: scenario.profile,
    aiUpdateIntervalMs,
    sampleIntervalMs: sim.options.sampleIntervalMs,
    units: sim.sortedUnits().map((u) => ({ id: u.id, name: u.name, kind: u.kind, role: u.role, approximate: u.approximate })),
  });
  const observations = evaluateObservations(scenario.observation.checks, trace, registry.checks);
  const summary = buildSummary(trace, collectLimitations(sim, data, [setup.script]), observations);
  return { outcome: outcome.kind, trace, summary };
}
