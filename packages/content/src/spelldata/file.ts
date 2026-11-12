/** The JSON written by `pnpm extract-spells` (packages/tools/src/extract.ts); the fields the content reads. */
export interface SpellDataFileInfo {
  readonly name: string;
  readonly sha256: string;
  readonly dataVersion: string;
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
}

/** Checks the structure the loaders rely on; every value they build is validated again by DataRegistry. */
export function parseSpellDataFile(raw: unknown): SpellDataFile {
  const o = raw as { files?: unknown; spells?: unknown } | null;
  if (typeof o !== 'object' || o === null || !Array.isArray(o.files) || !Array.isArray(o.spells)) {
    throw new Error('not a spell data file: it needs files and spells lists');
  }
  const ids = new Set<number>();
  for (const s of o.spells as { id?: unknown; effects?: unknown }[]) {
    if (typeof s !== 'object' || s === null || !Number.isInteger(s.id) || !Array.isArray(s.effects)) {
      throw new Error('every spell needs an integer id and an effects list');
    }
    const id = s.id as number;
    if (ids.has(id)) throw new Error(`duplicate spell ${id}`);
    ids.add(id);
  }
  return raw as SpellDataFile;
}
