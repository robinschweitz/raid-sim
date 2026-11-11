import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DBC_NAMES, loadClientSpellData, type DbcName } from '@raid/data';
import { dataVersionOf, extractSpells, type ExtractedFile } from './extract';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) {
    console.error('usage: pnpm extract-spells --dbc <folder with .dbc files> --spells <id,id,...> --out <file.json>');
    process.exit(64);
  }
  return v;
}

const dir = arg('dbc');
const roots = arg('spells')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const outFile = arg('out');
const present = new Map(readdirSync(dir).map((f) => [f.toLowerCase(), f]));
const bytes = {} as Record<DbcName, Uint8Array>;
const files: ExtractedFile[] = [];
for (const name of DBC_NAMES) {
  const actual = present.get(`${name.toLowerCase()}.dbc`);
  if (!actual) {
    console.error(`missing ${name}.dbc in ${dir}`);
    process.exit(1);
  }
  const content = readFileSync(join(dir, actual));
  bytes[name] = new Uint8Array(content);
  const sha256 = createHash('sha256').update(content).digest('hex');
  files.push({ name: `${name}.dbc`, sha256, dataVersion: dataVersionOf(`${name}.dbc`, sha256) });
}
const extraction = extractSpells(loadClientSpellData(bytes), files, roots);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(extraction, null, 2)}\n`);
console.log(`wrote ${extraction.spells.length} spells to ${outFile}`);
if (extraction.missing.length > 0) console.log(`not in the client data: ${extraction.missing.join(', ')}`);
console.log('add these to PINS.spellDataVersions (packages/data/src/pins.ts) and docs/sources.md:');
for (const f of files) console.log(`  ${f.dataVersion}   (sha256 ${f.sha256})`);
