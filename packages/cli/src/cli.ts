import { dirname, join, resolve } from 'node:path';
import { CONTENT, CONTENT_TEXT_EN } from '@raid/content';
import { canonicalStringify, parsePlan, parseScenario, prepareRun, runScenario, type ContentRegistry, type RunResult } from '@raid/engine';
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
  io.out(`deaths: ${s.deaths.length}`);
  for (const d of s.deaths) io.out(`  ${d.unit} at ${clock(d.atMs)}${d.killingBlow ? ` (${d.killingBlow.ability} from ${d.killingBlow.source})` : ''}`);
  for (const o of s.observations) io.out(`${o.pass ? 'PASS' : 'FAIL'} ${o.check}: ${o.detail}`);
  const l = s.limitations;
  io.out(`limitations: ${l.standIns.length} stand-ins, ${l.assumptions.length} assumptions, ${l.partialMechanics.length} partial mechanics`);
  io.out(`wrote ${dir}`);
  return s.observations.every((o) => o.pass) ? 0 : 1;
}
