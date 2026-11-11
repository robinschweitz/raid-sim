import { readFileSync, writeFileSync } from 'node:fs';
import { GOLDEN_FILE, checkGolden, fingerprint, readGolden } from './golden';

const io = { readFile: (p: string) => readFileSync(p, 'utf8') };
if (process.argv.includes('--update')) {
  const golden = readGolden(io);
  const updated: Record<string, string> = {};
  for (const scenario of Object.keys(golden).sort()) updated[scenario] = fingerprint(scenario, io);
  writeFileSync(GOLDEN_FILE, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`updated ${Object.keys(updated).length} fingerprints in ${GOLDEN_FILE}`);
} else {
  const mismatches = checkGolden(io);
  for (const m of mismatches) console.log(`changed: ${m.scenario}\n  expected ${m.expected}\n  actual   ${m.actual}`);
  console.log(mismatches.length === 0 ? 'all golden runs match' : `${mismatches.length} golden run(s) changed`);
  process.exit(mismatches.length === 0 ? 0 : 1);
}
