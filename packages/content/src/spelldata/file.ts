import { PINS } from '@raid/data';

/** The JSON written by `pnpm extract-spells` (packages/tools/src/extract.ts); the fields the content reads. */
export interface SpellDataFileInfo {
  readonly name: string;
  readonly sha256: string;
  /** `client-<build>:<file>:<first 12 hex of the sha256>`; checked against PINS.spellDataVersions at load. */
  readonly dataVersion: string;
  readonly archive?: string;
}

export interface SpellDataEffect {
  readonly index: number;
  readonly effect: number;
  readonly basePoints: number;
  readonly dieSides: number;
  readonly implicitTargetA: number;
  readonly implicitTargetB: number;
  readonly applyAuraName: number;
  readonly amplitude: number;
  readonly miscValue: number;
  readonly triggerSpell: number;
  readonly radiusIndex: number;
  readonly radiusYd: { readonly radius: number; readonly max: number } | null;
}

export interface SpellDataSpell {
  readonly id: number;
  readonly name: string;
  readonly attributes: number;
  readonly attributesEx: number;
  readonly attributesEx2: number;
  readonly attributesEx3: number;
  readonly attributesEx4: number;
  readonly attributesEx5: number;
  readonly attributesEx6: number;
  readonly attributesEx7: number;
  readonly schoolMask: number;
  readonly castTimeMs: number | null;
  readonly durationMs: { readonly base: number; readonly perLevel: number; readonly max: number } | null;
  readonly rangeYd: { readonly minHostile: number; readonly minFriendly: number; readonly maxHostile: number; readonly maxFriendly: number } | null;
  readonly speed: number;
  readonly stackAmount: number;
  readonly maxAffectedTargets: number;
  readonly effects: readonly SpellDataEffect[];
  /** SpellDifficulty row [10n, 25n, 10h, 25h], or null when the spell has none. */
  readonly difficultyVariants: readonly number[] | null;
}

export interface SpellDataFile {
  readonly client: string;
  readonly files: readonly SpellDataFileInfo[];
  readonly spells: readonly SpellDataSpell[];
  /** Requested spell ids the client data does not contain; a file with any cannot be used for sourcing. */
  readonly missing: readonly number[];
}

/** The pinned data version of each DBC file in the file, by file name; refuses a file with missing spells. */
export function spellDataVersions(file: SpellDataFile): ReadonlyMap<string, string> {
  if (file.missing.length > 0) throw new Error(`the spell data file has spells missing from the client data: ${file.missing.join(', ')}`);
  return new Map(file.files.map((f) => [f.name, f.dataVersion]));
}

/** Checks the structure the loaders rely on; every value they build is validated again by DataRegistry. */
export function parseSpellDataFile(raw: unknown): SpellDataFile {
  const o = raw as { files?: unknown; spells?: unknown; missing?: unknown } | null;
  if (typeof o !== 'object' || o === null || !Array.isArray(o.files) || !Array.isArray(o.spells)) {
    throw new Error('not a spell data file: it needs files and spells lists');
  }
  if (typeof (raw as { client?: unknown }).client !== 'string') throw new Error('the spell data file needs a client string');
  if (!Array.isArray(o.missing) || !o.missing.every((m) => Number.isInteger(m))) throw new Error('the spell data file needs a missing list of integers');
  const fileNames = new Set<string>();
  for (const f of o.files as { name?: unknown; sha256?: unknown; dataVersion?: unknown; archive?: unknown }[]) {
    if (typeof f !== 'object' || f === null || typeof f.name !== 'string' || typeof f.sha256 !== 'string' || typeof f.dataVersion !== 'string') {
      throw new Error('every file entry needs a name, sha256 and dataVersion string');
    }
    if (f.archive !== undefined && typeof f.archive !== 'string') throw new Error(`${f.name}: archive must be a string`);
    if (!/^client-\d+:[^:]+:[0-9a-f]{12}$/.test(f.dataVersion)) throw new Error(`${f.name}: malformed dataVersion ${f.dataVersion}`);
    if (!PINS.spellDataVersions.includes(f.dataVersion)) throw new Error(`${f.name} version ${f.dataVersion} is not pinned in pins.ts`);
    const [, vName, vHash] = f.dataVersion.split(':');
    if (vName !== f.name || vHash !== f.sha256.slice(0, 12)) throw new Error(`${f.name}: dataVersion ${f.dataVersion} does not match the file name and sha256`);
    if (fileNames.has(f.name)) throw new Error(`duplicate file ${f.name}`);
    fileNames.add(f.name);
  }
  const ids = new Set<number>();
  for (const s of o.spells as { id?: unknown; effects?: unknown; difficultyVariants?: unknown }[]) {
    if (typeof s !== 'object' || s === null || !Number.isInteger(s.id) || !Array.isArray(s.effects)) {
      throw new Error('every spell needs an integer id and an effects list');
    }
    const row = s.difficultyVariants;
    if (row !== undefined && row !== null && !(Array.isArray(row) && row.length === 4 && row.every((v) => Number.isInteger(v) && v >= 0))) {
      throw new Error(`spell ${s.id}: difficultyVariants must be null or 4 integers >= 0`);
    }
    const id = s.id as number;
    if (ids.has(id)) throw new Error(`duplicate spell ${id}`);
    ids.add(id);
  }
  for (const s of o.spells as Record<string, unknown>[]) checkSpell(s);
  return raw as SpellDataFile;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function numbers(where: string, o: Record<string, unknown>, keys: readonly string[]): void {
  for (const k of keys) if (!isNum(o[k])) throw new Error(`${where}: ${k} must be a finite number`);
}

function nullableRecord(where: string, v: unknown, name: string, keys: readonly string[]): void {
  if (v === null) return;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${where}: ${name} must be null or an object`);
  numbers(`${where}.${name}`, v as Record<string, unknown>, keys);
}

/** Every field entries.ts reads must be present with the right type. */
function checkSpell(s: Record<string, unknown>): void {
  const where = `spell ${s.id}`;
  numbers(where, s, ['schoolMask', 'stackAmount', 'maxAffectedTargets', 'speed', 'attributes', 'attributesEx', 'attributesEx2', 'attributesEx3', 'attributesEx4', 'attributesEx5', 'attributesEx6', 'attributesEx7']);
  if (s.castTimeMs !== null && !isNum(s.castTimeMs)) throw new Error(`${where}: castTimeMs must be null or a finite number`);
  nullableRecord(where, s.durationMs, 'durationMs', ['base', 'perLevel', 'max']);
  nullableRecord(where, s.rangeYd, 'rangeYd', ['minHostile', 'minFriendly', 'maxHostile', 'maxFriendly']);
  for (const e of s.effects as Record<string, unknown>[]) {
    if (typeof e !== 'object' || e === null) throw new Error(`${where}: every effect must be an object`);
    if (!Number.isInteger(e.index)) throw new Error(`${where}: effect index must be an integer`);
    const ew = `${where} effect ${e.index}`;
    numbers(ew, e, ['effect', 'basePoints', 'dieSides', 'implicitTargetA', 'implicitTargetB', 'applyAuraName', 'amplitude', 'miscValue', 'triggerSpell']);
    nullableRecord(ew, e.radiusYd, 'radiusYd', ['radius', 'max']);
  }
}
