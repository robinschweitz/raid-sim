import { parseWdbc, type DbcRow } from './wdbc';

/**
 * AzerothCore format strings for the spell DBC files (src/server/shared/DataStores/DBCfmt.h at the
 * pinned commit; line numbers in DBC_FORMAT_LINES).
 */
export const DBC_FORMATS = {
  Spell:
    'niiiiiiiiiiiixixiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiifxiiiiiiiiiiiiiiiiiiiiiiiiiiiifffiiiiiiiiiiiiiiiiiiiiifffiiiiiiiiiiiiiiifffiiiiiiiiiiiiiissssssssssssssssxssssssssssssssssxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxiiiiiiiiiiixfffxxxiiiiixxfffxx',
  SpellCastTimes: 'nixx',
  SpellDifficulty: 'niiii',
  SpellDuration: 'niii',
  SpellRadius: 'nfff',
  SpellRange: 'nffffixxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
} as const;
export type DbcName = keyof typeof DBC_FORMATS;
export const DBC_NAMES = Object.keys(DBC_FORMATS).sort() as DbcName[];
export const DBC_FORMAT_LINES: Readonly<Record<DbcName, number>> = {
  SpellCastTimes: 108,
  SpellDifficulty: 110,
  SpellDuration: 111,
  Spell: 112,
  SpellRadius: 116,
  SpellRange: 117,
};

/** Zero-based Spell.dbc columns; arrays of three (effects) start at the given column. See docs/research. */
export const SPELL_COLUMNS = {
  id: 0,
  attributes: 4,
  attributesEx: 5,
  castingTimeIndex: 28,
  recoveryTime: 29,
  categoryRecoveryTime: 30,
  interruptFlags: 31,
  auraInterruptFlags: 32,
  procFlags: 34,
  procChance: 35,
  durationIndex: 40,
  rangeIndex: 46,
  speed: 47,
  stackAmount: 49,
  effect: 71,
  effectDieSides: 74,
  effectBasePoints: 80,
  effectImplicitTargetA: 86,
  effectImplicitTargetB: 89,
  effectRadiusIndex: 92,
  effectApplyAuraName: 95,
  effectAmplitude: 98,
  effectChainTarget: 104,
  effectMiscValue: 110,
  effectTriggerSpell: 116,
  name: 136,
  startRecoveryCategory: 205,
  startRecoveryTime: 206,
  maxAffectedTargets: 212,
  dmgClass: 213,
  schoolMask: 225,
} as const;

export interface SpellEffectRecord {
  readonly effect: number;
  readonly dieSides: number;
  readonly basePoints: number;
  readonly implicitTargetA: number;
  readonly implicitTargetB: number;
  readonly radiusIndex: number;
  readonly applyAuraName: number;
  readonly amplitude: number;
  readonly chainTarget: number;
  readonly miscValue: number;
  readonly triggerSpell: number;
}

export interface SpellRecord {
  readonly id: number;
  readonly name: string;
  readonly attributes: number;
  readonly attributesEx: number;
  readonly castingTimeIndex: number;
  readonly recoveryTime: number;
  readonly categoryRecoveryTime: number;
  readonly interruptFlags: number;
  readonly auraInterruptFlags: number;
  readonly procFlags: number;
  readonly procChance: number;
  readonly durationIndex: number;
  readonly rangeIndex: number;
  readonly speed: number;
  readonly stackAmount: number;
  readonly startRecoveryCategory: number;
  readonly startRecoveryTime: number;
  readonly maxAffectedTargets: number;
  readonly dmgClass: number;
  readonly schoolMask: number;
  readonly effects: readonly [SpellEffectRecord, SpellEffectRecord, SpellEffectRecord];
}

export interface ClientSpellData {
  readonly spells: ReadonlyMap<number, SpellRecord>;
  readonly castTimes: ReadonlyMap<number, { readonly castTime: number }>;
  readonly duration: ReadonlyMap<number, { readonly base: number; readonly perLevel: number; readonly max: number }>;
  readonly radius: ReadonlyMap<number, { readonly radius: number; readonly perLevel: number; readonly max: number }>;
  readonly ranges: ReadonlyMap<
    number,
    { readonly minHostile: number; readonly minFriendly: number; readonly maxHostile: number; readonly maxFriendly: number; readonly flags: number }
  >;
  /** SpellDifficulty rows: [10n, 25n, 10h, 25h] spell ids, keyed by row id. */
  readonly difficulty: ReadonlyMap<number, readonly [number, number, number, number]>;
}

function num(row: DbcRow, i: number): number {
  const v = row[i];
  if (typeof v !== 'number') throw new Error(`column ${i} is not a number`);
  return v;
}

function effect(row: DbcRow, i: number): SpellEffectRecord {
  const c = SPELL_COLUMNS;
  return {
    effect: num(row, c.effect + i),
    dieSides: num(row, c.effectDieSides + i),
    basePoints: num(row, c.effectBasePoints + i),
    implicitTargetA: num(row, c.effectImplicitTargetA + i),
    implicitTargetB: num(row, c.effectImplicitTargetB + i),
    radiusIndex: num(row, c.effectRadiusIndex + i),
    applyAuraName: num(row, c.effectApplyAuraName + i),
    amplitude: num(row, c.effectAmplitude + i),
    chainTarget: num(row, c.effectChainTarget + i),
    miscValue: num(row, c.effectMiscValue + i),
    triggerSpell: num(row, c.effectTriggerSpell + i),
  };
}

export function decodeSpell(row: DbcRow): SpellRecord {
  const c = SPELL_COLUMNS;
  const name = row[c.name];
  return {
    id: num(row, c.id),
    name: typeof name === 'string' ? name : '',
    attributes: num(row, c.attributes),
    attributesEx: num(row, c.attributesEx),
    castingTimeIndex: num(row, c.castingTimeIndex),
    recoveryTime: num(row, c.recoveryTime),
    categoryRecoveryTime: num(row, c.categoryRecoveryTime),
    interruptFlags: num(row, c.interruptFlags),
    auraInterruptFlags: num(row, c.auraInterruptFlags),
    procFlags: num(row, c.procFlags),
    procChance: num(row, c.procChance),
    durationIndex: num(row, c.durationIndex),
    rangeIndex: num(row, c.rangeIndex),
    speed: num(row, c.speed),
    stackAmount: num(row, c.stackAmount),
    startRecoveryCategory: num(row, c.startRecoveryCategory),
    startRecoveryTime: num(row, c.startRecoveryTime),
    maxAffectedTargets: num(row, c.maxAffectedTargets),
    dmgClass: num(row, c.dmgClass),
    schoolMask: num(row, c.schoolMask),
    effects: [effect(row, 0), effect(row, 1), effect(row, 2)],
  };
}

export function loadClientSpellData(files: Readonly<Record<DbcName, Uint8Array>>): ClientSpellData {
  const table = (name: DbcName) => parseWdbc(files[name], DBC_FORMATS[name]).rows;
  const map = <T>(name: DbcName, f: (row: DbcRow) => T): Map<number, T> => {
    const out = new Map<number, T>();
    for (const [id, row] of table(name)) out.set(id, f(row));
    return out;
  };
  return {
    spells: map('Spell', decodeSpell),
    castTimes: map('SpellCastTimes', (r) => ({ castTime: num(r, 1) })),
    duration: map('SpellDuration', (r) => ({ base: num(r, 1), perLevel: num(r, 2), max: num(r, 3) })),
    radius: map('SpellRadius', (r) => ({ radius: num(r, 1), perLevel: num(r, 2), max: num(r, 3) })),
    ranges: map('SpellRange', (r) => ({ minHostile: num(r, 1), minFriendly: num(r, 2), maxHostile: num(r, 3), maxFriendly: num(r, 4), flags: num(r, 5) })),
    difficulty: map('SpellDifficulty', (r) => [num(r, 1), num(r, 2), num(r, 3), num(r, 4)] as const),
  };
}

/** The [10n, 25n, 10h, 25h] variants of a spell, like AzerothCore's GetSpellIdForDifficulty; null if none. */
export function difficultyVariants(data: ClientSpellData, spellId: number): readonly [number, number, number, number] | null {
  for (const id of [...data.difficulty.keys()].sort((a, b) => a - b)) {
    const row = data.difficulty.get(id)!;
    if (row.includes(spellId)) return row;
  }
  return null;
}
