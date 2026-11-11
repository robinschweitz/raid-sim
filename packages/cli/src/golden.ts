import { createHash } from 'node:crypto';
import { canonicalStringify } from '@raid/engine';
import { runScenarioFile, type Io } from './cli';

export const GOLDEN_FILE = 'scenarios/golden.json';

/** SHA-256 of the canonical trace of a scenario file. */
export function fingerprint(scenarioPath: string, io: Pick<Io, 'readFile'>): string {
  const r = runScenarioFile(scenarioPath, io);
  if (r.outcome === 'invalid') throw new Error(`${scenarioPath} is invalid: ${r.problems.map((p) => p.message).join('; ')}`);
  return createHash('sha256').update(canonicalStringify(r.trace)).digest('hex');
}

export interface GoldenMismatch {
  readonly scenario: string;
  readonly expected: string;
  readonly actual: string;
}

export function readGolden(io: Pick<Io, 'readFile'>): Record<string, string> {
  return JSON.parse(io.readFile(GOLDEN_FILE)) as Record<string, string>;
}

export function checkGolden(io: Pick<Io, 'readFile'>): GoldenMismatch[] {
  const golden = readGolden(io);
  return Object.keys(golden)
    .sort()
    .map((scenario) => ({ scenario, expected: golden[scenario], actual: fingerprint(scenario, io) }))
    .filter((m) => m.expected !== m.actual);
}
