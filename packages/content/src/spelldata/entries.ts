import { PINS, type DataEntry } from '@raid/data';
import { spellDataVersions, type SpellDataFile, type SpellDataSpell } from './file';

type DbcFile = 'Spell.dbc' | 'SpellCastTimes.dbc' | 'SpellDuration.dbc' | 'SpellRadius.dbc' | 'SpellRange.dbc';

/** Data key of a spell field: `spell.<id>.<field>`. */
export const spellKey = (spellId: number, field: string): string => `spell.${spellId}.${field}`;

const ATTRIBUTES = [
  ['attributes', 'attributes', 'Attributes'],
  ['attributes_ex', 'attributesEx', 'AttributesEx'],
  ['attributes_ex2', 'attributesEx2', 'AttributesEx2'],
  ['attributes_ex3', 'attributesEx3', 'AttributesEx3'],
  ['attributes_ex4', 'attributesEx4', 'AttributesEx4'],
  ['attributes_ex5', 'attributesEx5', 'AttributesEx5'],
  ['attributes_ex6', 'attributesEx6', 'AttributesEx6'],
  ['attributes_ex7', 'attributesEx7', 'AttributesEx7'],
] as const;

/**
 * Sourced data entries (spec §7) for the given spells of a spell data file: raw fields as `spelldata` with the pinned
 * version of the DBC file they come from, the effect value range as `derived` from basePoints and dieSides. Refuses a
 * file with missing spells, an id that is not in the file and a file version that is not pinned.
 */
export function spellDataEntries(file: SpellDataFile, ids: readonly number[]): DataEntry[] {
  const versions = spellDataVersions(file);
  const version = (name: DbcFile): string => {
    const v = versions.get(name);
    if (v === undefined) throw new Error(`the spell data file lists no ${name}`);
    if (!PINS.spellDataVersions.includes(v)) throw new Error(`${name} version ${v} is not pinned in pins.ts`);
    return v;
  };
  const byId = new Map(file.spells.map((s) => [s.id, s]));
  const out: DataEntry[] = [];
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const s = byId.get(id);
    if (!s) throw new Error(`spell ${id} is not in the spell data file`);
    out.push(...entriesOf(s, version));
  }
  return out;
}

function entriesOf(s: SpellDataSpell, version: (name: DbcFile) => string): DataEntry[] {
  const out: DataEntry[] = [];
  const put = (field: string, value: number, dbc: DbcFile, column: string): void => {
    out.push({ key: spellKey(s.id, field), value, source: { kind: 'spelldata', spellId: s.id, field: column, dataVersion: version(dbc) } });
  };
  put('school_mask', s.schoolMask, 'Spell.dbc', 'SchoolMask');
  put('max_stacks', s.stackAmount, 'Spell.dbc', 'StackAmount');
  put('max_targets', s.maxAffectedTargets, 'Spell.dbc', 'MaxAffectedTargets');
  put('speed', s.speed, 'Spell.dbc', 'Speed');
  for (const [field, prop, column] of ATTRIBUTES) put(field, s[prop], 'Spell.dbc', column);
  if (s.castTimeMs !== null) put('cast_time_ms', s.castTimeMs, 'SpellCastTimes.dbc', 'CastTime (via CastingTimeIndex)');
  if (s.durationMs !== null) put('duration_ms', s.durationMs.base, 'SpellDuration.dbc', 'Duration (via DurationIndex; -1 = permanent)');
  if (s.rangeYd !== null) put('range_yd', s.rangeYd.maxHostile, 'SpellRange.dbc', 'RangeMax hostile (via RangeIndex)');
  for (const e of s.effects) {
    const p = `e${e.index}`;
    const i = e.index;
    put(`${p}.effect`, e.effect, 'Spell.dbc', `Effect[${i}]`);
    put(`${p}.aura`, e.applyAuraName, 'Spell.dbc', `EffectApplyAuraName[${i}]`);
    put(`${p}.base_points`, e.basePoints, 'Spell.dbc', `EffectBasePoints[${i}]`);
    put(`${p}.die_sides`, e.dieSides, 'Spell.dbc', `EffectDieSides[${i}]`);
    put(`${p}.amplitude_ms`, e.amplitude, 'Spell.dbc', `EffectAmplitude[${i}]`);
    put(`${p}.misc_value`, e.miscValue, 'Spell.dbc', `EffectMiscValue[${i}]`);
    put(`${p}.trigger_spell`, e.triggerSpell, 'Spell.dbc', `EffectTriggerSpell[${i}]`);
    put(`${p}.target_a`, e.implicitTargetA, 'Spell.dbc', `EffectImplicitTargetA[${i}]`);
    put(`${p}.target_b`, e.implicitTargetB, 'Spell.dbc', `EffectImplicitTargetB[${i}]`);
    if (e.radiusYd !== null) put(`${p}.radius_yd`, e.radiusYd.radius, 'SpellRadius.dbc', `Radius (via EffectRadiusIndex[${i}])`);
    const inputs = [spellKey(s.id, `${p}.base_points`), spellKey(s.id, `${p}.die_sides`)];
    out.push({
      key: spellKey(s.id, `${p}.min`),
      value: e.basePoints + (e.dieSides > 0 ? 1 : 0),
      source: { kind: 'derived', formula: 'basePoints + (dieSides > 0 ? 1 : 0) (SpellEffectInfo::CalcValue, SpellInfo.cpp 409–447)', inputs },
    });
    out.push({
      key: spellKey(s.id, `${p}.max`),
      value: e.basePoints + e.dieSides,
      source: { kind: 'derived', formula: 'basePoints + dieSides (SpellEffectInfo::CalcValue, SpellInfo.cpp 409–447)', inputs },
    });
  }
  return out;
}
