import { isAbsolute, relative, resolve, sep } from 'node:path';
import { DBC_NAMES, difficultyVariants, type ClientSpellData, type DbcName } from '@raid/data';

export interface ExtractedFile {
  readonly name: string;
  readonly sha256: string;
  readonly dataVersion: string;
  /** The client archive the file came from (relative to the client folder), when read from the archives. */
  readonly archive?: string;
}

export interface ExtractedEffect {
  readonly index: number;
  readonly effect: number;
  readonly basePoints: number;
  readonly dieSides: number;
  readonly implicitTargetA: number;
  readonly implicitTargetB: number;
  readonly applyAuraName: number;
  readonly amplitude: number;
  readonly chainTarget: number;
  readonly miscValue: number;
  readonly triggerSpell: number;
  readonly radiusIndex: number;
  readonly radiusYd: { readonly radius: number; readonly max: number } | null;
  readonly mechanic: number;
  readonly realPointsPerLevel: number;
  readonly valueMultiplier: number;
  readonly damageMultiplier: number;
  readonly bonusMultiplier: number;
  readonly classMask: readonly [number, number, number];
}

export interface ExtractedSpell {
  readonly id: number;
  readonly name: string;
  readonly nameLocale: number;
  readonly attributes: number;
  readonly attributesEx: number;
  readonly attributesEx2: number;
  readonly attributesEx3: number;
  readonly attributesEx4: number;
  readonly attributesEx5: number;
  readonly attributesEx6: number;
  readonly attributesEx7: number;
  readonly dispel: number;
  readonly mechanic: number;
  readonly targets: number;
  readonly spellFamilyName: number;
  readonly spellFamilyFlags: readonly [number, number, number];
  readonly preventionType: number;
  readonly schoolMask: number;
  readonly dmgClass: number;
  readonly castTimeMs: number | null;
  readonly durationMs: { readonly base: number; readonly perLevel: number; readonly max: number } | null;
  readonly rangeYd: { readonly minHostile: number; readonly minFriendly: number; readonly maxHostile: number; readonly maxFriendly: number } | null;
  readonly speed: number;
  readonly stackAmount: number;
  readonly recoveryTime: number;
  readonly categoryRecoveryTime: number;
  readonly startRecoveryTime: number;
  readonly maxAffectedTargets: number;
  readonly procFlags: number;
  readonly procChance: number;
  readonly interruptFlags: number;
  readonly auraInterruptFlags: number;
  readonly effects: readonly ExtractedEffect[];
  readonly difficultyVariants: readonly number[] | null;
}

export interface Extraction {
  readonly client: '3.3.5a (12340)';
  readonly files: readonly ExtractedFile[];
  readonly spells: readonly ExtractedSpell[];
  readonly missing: readonly number[];
}

export function dataVersionOf(fileName: string, sha256: string): string {
  return `client-12340:${fileName}:${sha256.slice(0, 12)}`;
}

/** Extracts the root spells plus every triggered spell and difficulty variant they reach. */
export function extractSpells(data: ClientSpellData, files: readonly ExtractedFile[], roots: readonly number[]): Extraction {
  const seen = new Set<number>();
  const missing = new Set<number>();
  const queue = [...roots];
  const out: ExtractedSpell[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === 0 || seen.has(id)) continue;
    seen.add(id);
    const s = data.spells.get(id);
    if (!s) {
      missing.add(id);
      continue;
    }
    const variants = difficultyVariants(data, id);
    if (variants) queue.push(...variants);
    const effects: ExtractedEffect[] = [];
    s.effects.forEach((e, index) => {
      if (e.effect === 0) return;
      if (e.triggerSpell !== 0) queue.push(e.triggerSpell);
      const r = e.radiusIndex ? data.radius.get(e.radiusIndex) : undefined;
      effects.push({
        index,
        effect: e.effect,
        basePoints: e.basePoints,
        dieSides: e.dieSides,
        implicitTargetA: e.implicitTargetA,
        implicitTargetB: e.implicitTargetB,
        applyAuraName: e.applyAuraName,
        amplitude: e.amplitude,
        chainTarget: e.chainTarget,
        miscValue: e.miscValue,
        triggerSpell: e.triggerSpell,
        radiusIndex: e.radiusIndex,
        radiusYd: r ? { radius: r.radius, max: r.max } : null,
        mechanic: e.mechanic,
        realPointsPerLevel: e.realPointsPerLevel,
        valueMultiplier: e.valueMultiplier,
        damageMultiplier: e.damageMultiplier,
        bonusMultiplier: e.bonusMultiplier,
        classMask: e.classMask,
      });
    });
    const range = data.ranges.get(s.rangeIndex);
    out.push({
      id: s.id,
      name: s.name,
      nameLocale: s.nameLocale,
      attributes: s.attributes,
      attributesEx: s.attributesEx,
      attributesEx2: s.attributesEx2,
      attributesEx3: s.attributesEx3,
      attributesEx4: s.attributesEx4,
      attributesEx5: s.attributesEx5,
      attributesEx6: s.attributesEx6,
      attributesEx7: s.attributesEx7,
      dispel: s.dispel,
      mechanic: s.mechanic,
      targets: s.targets,
      spellFamilyName: s.spellFamilyName,
      spellFamilyFlags: s.spellFamilyFlags,
      preventionType: s.preventionType,
      schoolMask: s.schoolMask,
      dmgClass: s.dmgClass,
      castTimeMs: data.castTimes.get(s.castingTimeIndex)?.castTime ?? null,
      durationMs: data.duration.get(s.durationIndex) ?? null,
      rangeYd: range
        ? { minHostile: range.minHostile, minFriendly: range.minFriendly, maxHostile: range.maxHostile, maxFriendly: range.maxFriendly }
        : null,
      speed: s.speed,
      stackAmount: s.stackAmount,
      recoveryTime: s.recoveryTime,
      categoryRecoveryTime: s.categoryRecoveryTime,
      startRecoveryTime: s.startRecoveryTime,
      maxAffectedTargets: s.maxAffectedTargets,
      procFlags: s.procFlags,
      procChance: s.procChance,
      interruptFlags: s.interruptFlags,
      auraInterruptFlags: s.auraInterruptFlags,
      effects,
      difficultyVariants: variants ? [...variants] : null,
    });
  }
  out.sort((a, b) => a.id - b.id);
  return { client: '3.3.5a (12340)', files: [...files], spells: out, missing: [...missing].sort((a, b) => a - b) };
}

export function parseSpellIds(text: string): number[] {
  if (text.trim() === '') throw new Error('no spell ids given');
  const ids = text.split(',').map((raw) => {
    const token = raw.trim();
    if (!/^[1-9]\d*$/.test(token)) throw new Error(`invalid spell id "${token}"`);
    return Number(token);
  });
  return ids;
}

/** Maps each required DBC to its actual file name, matching `<Name>.dbc` case-insensitively. */
export function findDbcFiles(fileNames: readonly string[]): Record<DbcName, string> {
  const out = {} as Record<DbcName, string>;
  const missing: string[] = [];
  for (const name of DBC_NAMES) {
    const wanted = `${name}.dbc`.toLowerCase();
    const matches = fileNames.filter((f) => f.toLowerCase() === wanted);
    if (matches.length > 1) throw new Error(`two files match ${name}.dbc: ${matches.join(', ')}`);
    if (matches.length === 0) missing.push(`${name}.dbc`);
    else out[name] = matches[0]!;
  }
  if (missing.length > 0) throw new Error(`missing ${missing.join(', ')}`);
  return out;
}

/** The locale to read: the requested one, or the only installed one. */
export function pickLocale(installed: readonly string[], requested: string | undefined): string {
  if (requested) return requested;
  if (installed.length === 1) return installed[0]!;
  if (installed.length === 0) throw new Error('no locale folder (Data/xxXX) found: pass --locale');
  throw new Error(`several locales installed (${installed.join(', ')}): pass --locale`);
}

/** Extracted DBC files must not land in the repository, except under the git-ignored client-data/. */
export function checkSaveDbcDir(repoRoot: string, dir: string): void {
  const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const inside = (parent: string, child: string): boolean => {
    const rel = relative(fold(resolve(parent)), fold(resolve(child)));
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
  };
  if (inside(repoRoot, dir) && !inside(resolve(repoRoot, 'client-data'), dir)) {
    throw new Error(`--save-dbc ${dir} is inside the repository: use a folder outside it or under client-data/`);
  }
}

/** Output files must not be written into the (read-only) client folder. */
export function checkOutsideClient(clientDir: string, path: string, flag: string): void {
  const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = relative(fold(resolve(clientDir)), fold(resolve(path)));
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
    throw new Error(`${flag} ${path}: refusing to write inside the client folder`);
  }
}
