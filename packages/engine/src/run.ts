import { DataRegistry, DataValidationError, PINS, type Difficulty } from '@raid/data';
import { attachBoss, type BossScript } from './boss';
import { installCoreRules } from './casting';
import { ActorController, type ActorPolicy } from './controller';
import { CORE_DATA } from './core-data';
import { collectLimitations } from './limitations';
import { evaluateObservations, type CustomCheck } from './observations';
import type { PreparedRun } from './plan/prepare';
import type { ModelledMember } from './plan/schema';
import type { LoadProblem } from './plan/validate';
import { BUILTIN_ACTIONS, ENGINE_ACTION_NAMES, RuleEngine, createTauntAction, type ActionHandler } from './rules';
import { Simulation, type OutcomeKind } from './sim';
import { installStandin, type StandinParams } from './standin';
import { buildSummary, type Summary } from './summary';
import { ThreatManager } from './threat';
import { canonicalStringify, type Trace } from './trace';
import { byId, type Role, type UnitInit } from './units';

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
    if (!ENGINE_ACTION_NAMES.has(r.do.do) && !reg.actions.has(r.do.do)) {
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

function dataProblems(file: string, build: () => unknown): LoadProblem[] {
  try {
    build();
    return [];
  } catch (e) {
    if (e instanceof DataValidationError) return e.problems.map((message) => ({ file, path: '(data)', message }));
    throw e;
  }
}

function setupFailure(file: string, e: unknown): RunResult {
  return { outcome: 'invalid', problems: [{ file, path: '(setup)', message: e instanceof Error ? e.message : String(e) }] };
}

export function runScenario(prepared: PreparedRun, registry: ContentRegistry): RunResult {
  const problems = checkContent(prepared, registry);
  if (problems.length > 0) return { outcome: 'invalid', problems };
  const { scenario, plan } = prepared;
  const boss = registry.bosses.get(plan.boss)!;

  // Engine data is validated on its own so a problem in it is not blamed on the boss content.
  const coreProblems = dataProblems('engine:core-data', () => new DataRegistry(CORE_DATA));
  if (coreProblems.length > 0) return { outcome: 'invalid', problems: coreProblems };
  let data!: DataRegistry;
  const bossProblems = dataProblems(`boss:${boss.id}`, () => {
    data = new DataRegistry([...CORE_DATA, ...boss.data], boss.overrides, scenario.profile);
  });
  if (bossProblems.length > 0) return { outcome: 'invalid', problems: bossProblems };

  const sim = new Simulation({
    seed: scenario.seed,
    maxDurationMs: scenario.maxDurationMs,
    sampleIntervalMs: data.num('core.sample_interval_ms'),
  });
  installCoreRules(sim);
  const threat = new ThreatManager(sim, data.num('core.threat_update_interval_ms'));
  threat.install();
  // Content setup errors (an unknown data key, a throwing model factory) are reported as invalid input.
  let setup!: BossSetup;
  try {
    setup = boss.setup({ sim, data, difficulty: scenario.difficulty });
  } catch (e) {
    return setupFailure(`boss:${boss.id}`, e);
  }
  const handlers = new Map<string, ActionHandler>(BUILTIN_ACTIONS);
  if (plan.rules.some((r) => r.do.do === 'taunt')) {
    handlers.set(
      'taunt',
      createTauntAction({
        rangeYd: data.num('core.taunt_range_yd'),
        cooldownMs: data.num('core.taunt_cooldown_ms'),
        durationMs: data.num('core.taunt_duration_ms'),
      }),
    );
  }
  for (const [name, handler] of registry.actions) handlers.set(name, handler);
  const rules = new RuleEngine(sim, plan, handlers, {
    currentTank: () => threat.victim(setup.bossUnitId),
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

  // Roster order must not matter (§8.7): everything below walks the roster sorted by id.
  const roster = [...plan.roster].sort(byId);
  const controllers: ActorController[] = [];
  for (const m of roster) {
    const pos = plan.spots[rules.assignment(m.id)!];
    if (m.kind === 'modelled') {
      const factory = registry.policies.get(m.spec)!;
      let made: ReturnType<PolicyFactory['create']>;
      try {
        made = factory.create({ sim, member: m, data });
      } catch (e) {
        return setupFailure(`spec:${m.spec}`, e);
      }
      sim.addUnit({ ...made.unit, id: m.id, name: m.name, kind: 'player', role: factory.role, pos });
      controllers.push(new ActorController(sim, m.id, made.policy, hooks));
    } else {
      sim.addUnit({ ...playerBody, id: m.id, name: m.name, kind: 'player', role: m.role, approximate: true, maxHealth: m.maxHealth, armor: m.armor, avoidance: m.avoidance, threatMultiplier: m.threatMultiplier, pos });
    }
  }
  rules.install();
  for (const c of controllers) c.install();
  const standins = roster.filter((m) => m.kind === 'standin');
  if (standins.length > 0) {
    const params: StandinParams = {
      tickMs: data.num('core.standin_tick_ms'),
      rangeYd: {
        tank: data.num('core.standin_range_tank_yd'),
        melee: data.num('core.standin_range_melee_yd'),
        ranged: data.num('core.standin_range_ranged_yd'),
        healer: data.num('core.standin_range_healer_yd'),
      },
    };
    for (const m of standins) installStandin(sim, m, params);
  }
  const aiUpdateIntervalMs = data.num('core.ai_update_interval_ms');
  attachBoss(sim, setup.script, setup.bossUnitId, aiUpdateIntervalMs);
  try {
    setup.pull(sim);
  } catch (e) {
    return setupFailure(`boss:${boss.id}`, e);
  }
  const outcome = sim.run();

  const trace = sim.trace.build({
    engineVersion: ENGINE_VERSION,
    azerothcoreCommit: PINS.azerothcoreCommit,
    spellDataVersions: [...PINS.spellDataVersions],
    scenario: scenario.id,
    plan: plan.id,
    maxDurationMs: scenario.maxDurationMs,
    mistakes: scenario.mistakes.map((m) => canonicalStringify(m)),
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
