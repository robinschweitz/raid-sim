import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DBC_FORMATS, DBC_NAMES, loadClientSpellData, parseWdbc, type DbcName } from '@raid/data';
import { dataVersionOf, extractSpells, findDbcFiles, parseSpellIds, type ExtractedFile } from './extract';

const USAGE = 'usage: pnpm extract-spells --dbc <folder with .dbc files> --spells <id,id,...> --out <file.json>';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) {
    console.error(USAGE);
    process.exit(64);
  }
  return v;
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function run(): void {
  const dir = arg('dbc');
  const roots = parseSpellIds(arg('spells'));
  const outFile = arg('out');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    throw new Error(`cannot read folder ${dir}: ${reason(e)}`);
  }
  const actual = findDbcFiles(names);
  const bytes = {} as Record<DbcName, Uint8Array>;
  const files: ExtractedFile[] = [];
  for (const name of DBC_NAMES) {
    const path = join(dir, actual[name]);
    let content: Buffer;
    try {
      content = readFileSync(path);
    } catch (e) {
      throw new Error(`cannot read ${path}: ${reason(e)}`);
    }
    bytes[name] = new Uint8Array(content);
    try {
      parseWdbc(bytes[name], DBC_FORMATS[name]);
    } catch (e) {
      throw new Error(`${name}.dbc: ${reason(e)}`);
    }
    const sha256 = createHash('sha256').update(content).digest('hex');
    files.push({ name: `${name}.dbc`, sha256, dataVersion: dataVersionOf(`${name}.dbc`, sha256) });
  }
  const extraction = extractSpells(loadClientSpellData(bytes), files, roots);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(extraction, null, 2)}
`);
  console.log(`wrote ${extraction.spells.length} spells to ${outFile}`);
  if (extraction.spells.length > 0 && extraction.spells.every((s) => s.name === '')) console.log('warning: no spell names found in any locale');
  if (extraction.missing.length > 0) console.log(`not in the client data: ${extraction.missing.join(', ')}`);
  console.log('add these to PINS.spellDataVersions (packages/data/src/pins.ts) and docs/sources.md:');
  for (const f of files) console.log(`  ${f.dataVersion}   (sha256 ${f.sha256})`);
}

try {
  run();
} catch (e) {
  console.error(`error: ${reason(e)}`);
  process.exit(1);
}
