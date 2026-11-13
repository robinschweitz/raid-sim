import { dirname, join, resolve } from 'node:path';
import { CONTENT, CONTENT_TEXT_EN } from '@raid/content';
import { DEFAULT_PROFILE_REASON, canonicalStringify, parsePlan, parseScenario, prepareRun, runScenario, type ContentRegistry, type RunResult } from '@raid/engine';
import { EN, clock, formatLog } from '@raid/format';

export interface Io {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  mkdir(path: string): void;
  out(line: string): void;
}

export interface RunOptions {
  readonly seed?: number;
}

const USAGE = 'usage: raid-sim run <scenario.yaml> [--out <dir>] [--seed <n>]';

function readOrProblem(io: Pick<Io, 'readFile'>, path: string, from: string): string | RunResult {
  try {
    return io.readFile(path);
  } catch {
    return { outcome: 'invalid', problems: [{ file: from, path: '(file)', message: `cannot read ${path}` }] };
  }
}

/** Loads a scenario and its plan from disk and runs it. */
export function runScenarioFile(scenarioPath: string, io: Pick<Io, 'readFile'>, registry: ContentRegistry = CONTENT, options: RunOptions = {}): RunResult {
  const scenarioText = readOrProblem(io, scenarioPath, scenarioPath);
  if (typeof scenarioText !== 'string') return scenarioText;
  const scenario = parseScenario(scenarioPath, scenarioText);
  if (!scenario.ok) return { outcome: 'invalid', problems: scenario.problems };
  const planPath = resolve(dirname(scenarioPath), scenario.value.plan);
  const planText = readOrProblem(io, planPath, scenarioPath);
  if (typeof planText !== 'string') return planText;
  const plan = parsePlan(planPath, planText);
  if (!plan.ok) return { outcome: 'invalid', problems: plan.problems };
  const s = options.seed === undefined ? scenario.value : { ...scenario.value, seed: options.seed };
  const prepared = prepareRun({ scenario: s, scenarioFile: scenarioPath, plan: plan.value, planFile: planPath });
  if (!prepared.ok) return { outcome: 'invalid', problems: prepared.problems };
  return runScenario(prepared.value, registry);
}

export function runCli(argv: readonly string[], io: Io, registry: ContentRegistry = CONTENT, text: Readonly<Record<string, string>> = CONTENT_TEXT_EN): number {
  const [command, scenarioPath, ...rest] = argv;
  if (command !== 'run' || !scenarioPath) {
    io.out(USAGE);
    return 64;
  }
  let outDir: string | undefined;
  let seed: number | undefined;
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (value === undefined || (flag !== '--out' && flag !== '--seed')) {
      io.out(USAGE);
      return 64;
    }
    if (flag === '--out') outDir = value;
    else {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) {
        io.out(`invalid seed ${value}`);
        return 64;
      }
      seed = n;
    }
  }
  const result = runScenarioFile(scenarioPath, io, registry, seed === undefined ? {} : { seed });
  if (result.outcome === 'invalid') {
    io.out('invalid input:');
    for (const p of result.problems) io.out(`  ${p.file}: ${p.path}: ${p.message}`);
    return 2;
  }
  const dir = outDir ?? join('out', result.trace.meta.scenario);
  const files: Array<[string, string]> = [
    [join(dir, 'trace.json'), `${canonicalStringify(result.trace)}\n`],
    [join(dir, 'summary.json'), `${canonicalStringify(result.summary)}\n`],
    [join(dir, 'log.txt'), `${formatLog(result.trace, EN, text).join('\n')}\n`],
  ];
  let failing = dir;
  try {
    io.mkdir(dir);
    for (const [path, content] of files) {
      failing = path;
      io.writeFile(path, content);
    }
  } catch (e) {
    io.out(`cannot write ${failing}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  const s = result.summary;
  io.out(`${result.trace.meta.scenario}: ${s.outcome} at ${clock(s.durationMs)}`);
  const players = new Set(result.trace.meta.units.filter((u) => u.kind === 'player').map((u) => u.id));
  const death = (d: (typeof s.deaths)[number]): string =>
    `  ${d.unit} at ${clock(d.atMs)}${d.killingBlow ? ` (${d.killingBlow.ability} from ${d.killingBlow.source})` : ''}`;
  const playerDeaths = s.deaths.filter((d) => players.has(d.unit));
  const bossDeaths = s.deaths.filter((d) => !players.has(d.unit));
  io.out(`player deaths: ${playerDeaths.length}`);
  for (const d of playerDeaths) io.out(death(d));
  io.out(`boss deaths: ${bossDeaths.length}`);
  for (const d of bossDeaths) io.out(death(d));
  for (const o of s.observations) io.out(`${o.pass ? 'PASS' : 'FAIL'} ${o.check}: ${o.detail}`);
  const l = s.limitations;
  const partial = l.partialMechanics.filter((m) => m.status === 'partial').length;
  const notImplemented = l.partialMechanics.filter((m) => m.status === 'not_implemented').length;
  io.out(
    `limitations: ${l.standIns.length} stand-ins, ${l.assumptions.length} assumptions, ${partial} partial mechanics, ${notImplemented} not implemented, ${l.profileValues.length} stand-in profile values`,
  );
  // Profiles the plan explains (a reason other than the default) are spelled out: they stand in for player behaviour.
  const explained = new Map<string, typeof l.profileValues>();
  for (const v of l.profileValues) if (v.reason !== DEFAULT_PROFILE_REASON) explained.set(v.unit, [...(explained.get(v.unit) ?? []), v]);
  for (const [unit, values] of explained) {
    const reasons = [...new Set(values.map((v) => v.reason))].join('; ');
    io.out(`  profile ${unit}: ${values.map((v) => `${v.field} ${v.value}`).join(', ')} (${reasons})`);
  }
  io.out(`wrote ${dir}`);
  return s.observations.every((o) => o.pass) ? 0 : 1;
}
