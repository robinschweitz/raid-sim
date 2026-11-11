import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DBC_FORMATS, DBC_NAMES, loadClientSpellData, parseWdbc, type DbcName } from '@raid/data';
import { checkOutsideClient, checkSaveDbcDir, dataVersionOf, extractSpells, findDbcFiles, parseSpellIds, pickLocale, type ExtractedFile } from './extract';
import { clientArchiveOrder, fileByteSource, findInArchives, installedLocales, type FileByteSource } from './mpq';

const USAGE = [
  'usage: pnpm extract-spells --client <WoW client folder> [--locale <xxXX>] --spells <id,id,...> --out <file.json> [--save-dbc <folder>]',
  '   or: pnpm extract-spells --dbc <folder with .dbc files> --spells <id,id,...> --out <file.json>',
].join('\n');

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function usage(): never {
  console.error(USAGE);
  process.exit(64);
}

function optional(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) usage();
  return v;
}

function arg(name: string): string {
  return optional(name) ?? usage();
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface RawDbc {
  readonly bytes: Uint8Array;
  readonly archive?: string;
}

function fromFolder(dir: string): Record<DbcName, RawDbc> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    throw new Error(`cannot read folder ${dir}: ${reason(e)}`);
  }
  const actual = findDbcFiles(names);
  const out = {} as Record<DbcName, RawDbc>;
  for (const name of DBC_NAMES) {
    const path = join(dir, actual[name]);
    try {
      out[name] = { bytes: new Uint8Array(readFileSync(path)) };
    } catch (e) {
      throw new Error(`cannot read ${path}: ${reason(e)}`);
    }
  }
  return out;
}

function fromClient(clientDir: string, requestedLocale: string | undefined): Record<DbcName, RawDbc> {
  const locale = pickLocale(installedLocales(clientDir), requestedLocale);
  const order = clientArchiveOrder(clientDir, locale);
  console.log(`client ${clientDir}, locale ${locale}: ${order.length} archives`);
  const sources: { name: string; source: FileByteSource }[] = [];
  try {
    for (const a of order) {
      try {
        sources.push({ name: a.name, source: fileByteSource(a.path) });
      } catch (e) {
        throw new Error(`cannot open ${a.path}: ${reason(e)}`);
      }
    }
    const out = {} as Record<DbcName, RawDbc>;
    for (const name of DBC_NAMES) {
      const file = `DBFilesClient\\${name}.dbc`;
      const found = findInArchives(sources, file);
      if (!found) throw new Error(`${file} not found in any archive`);
      out[name] = { bytes: found.bytes, archive: found.archive };
    }
    return out;
  } finally {
    for (const s of sources) s.source.close();
  }
}

function run(): void {
  const dbcDir = optional('dbc');
  const clientDir = optional('client');
  if ((dbcDir === undefined) === (clientDir === undefined)) usage();
  const roots = parseSpellIds(arg('spells'));
  const outFile = arg('out');
  const saveDir = optional('save-dbc');
  if (saveDir !== undefined) checkSaveDbcDir(REPO_ROOT, saveDir);
  if (clientDir !== undefined) {
    checkOutsideClient(clientDir, outFile, '--out');
    if (saveDir !== undefined) checkOutsideClient(clientDir, saveDir, '--save-dbc');
  }

  const raw = clientDir !== undefined ? fromClient(clientDir, optional('locale')) : fromFolder(dbcDir!);
  const bytes = {} as Record<DbcName, Uint8Array>;
  const files: ExtractedFile[] = [];
  for (const name of DBC_NAMES) {
    const { bytes: content, archive } = raw[name];
    bytes[name] = content;
    try {
      parseWdbc(content, DBC_FORMATS[name]);
    } catch (e) {
      throw new Error(`${name}.dbc${archive ? ` (from ${archive})` : ''}: ${reason(e)}`);
    }
    const sha256 = createHash('sha256').update(content).digest('hex');
    const entry: ExtractedFile = { name: `${name}.dbc`, sha256, dataVersion: dataVersionOf(`${name}.dbc`, sha256) };
    files.push(archive === undefined ? entry : { ...entry, archive });
  }
  if (saveDir !== undefined) {
    mkdirSync(saveDir, { recursive: true });
    for (const name of DBC_NAMES) writeFileSync(join(saveDir, `${name}.dbc`), bytes[name]);
    console.log(`saved the ${DBC_NAMES.length} DBC files to ${saveDir}`);
  }
  const extraction = extractSpells(loadClientSpellData(bytes), files, roots);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(extraction, null, 2)}\n`);
  console.log(`wrote ${extraction.spells.length} spells to ${outFile}`);
  if (extraction.spells.length > 0 && extraction.spells.every((s) => s.name === '')) console.log('warning: no spell names found in any locale');
  if (extraction.missing.length > 0) console.log(`not in the client data: ${extraction.missing.join(', ')}`);
  console.log('add these to PINS.spellDataVersions (packages/data/src/pins.ts) and docs/sources.md:');
  for (const f of files) console.log(`  ${f.dataVersion}   (sha256 ${f.sha256})${f.archive ? `   from ${f.archive}` : ''}`);
}

try {
  run();
} catch (e) {
  console.error(`error: ${reason(e)}`);
  process.exit(1);
}
