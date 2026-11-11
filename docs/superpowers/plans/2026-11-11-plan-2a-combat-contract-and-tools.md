# Plan 2a — Client Data Tools, Combat Contract and CLI (Gate 1, Plan 2 of 3, part a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything Festergut needs that does not depend on his spell numbers: a tool that extracts spell data from the owner's 3.3.5a client, threat and taunt, boss melee with armor, triggered casts and target selection, aura scripts and damage modifiers, an explicit kill set, script state, content validation, a content package, the `raid-sim run` command, and golden runs.

**Architecture:** New pure parsing code lives in `@raid/data` (browser-safe, no `node:` imports). A new `@raid/tools` package holds Node-only extraction. The engine gains `threat.ts`, `melee.ts`, `modifiers.ts` and extends `catalog`, `auras`, `casting`, `boss`, `rules`, `run`. A new `@raid/content` package registers encounters (the training dummy for now; Festergut in Plan 2b). A new `@raid/cli` package reads YAML from disk and writes trace, log and summary.

**Tech Stack:** as Plan 1, plus `tsx` 4.19.2 to run TypeScript entry points with Node.

**Spec:** `docs/superpowers/specs/2026-11-10-festergut-pilot-design.md` (rev. 2). **Research:** `docs/research/festergut-azerothcore.md` (facts read from AzerothCore at the pinned commit). **Contract list:** `docs/superpowers/plans/2026-11-10-contract-changes-for-plans-2-3.md`.

---

## Why Plan 2 is split

Festergut's script needs spell numbers (radii, durations, damage, tick intervals, difficulty variants) that only exist in the client's DBC files, which the owner extracts locally (decision in `docs/sources.md`). Plan 2a builds everything that is independent of those numbers and can run now. Plan 2b (written after the extraction) adds the Festergut data, script, Gate 1 scenarios and their golden runs.

Gate 1 is 25-player normal only, so heroic Malleable Goo (Putricide casting from Festergut's script, point-targeted areas) is not in Plan 2 (spec §4, Gate 4).

## Conventions

As Plan 1:
- Run from `E:\raid-explainer` in Git Bash. Start each shell with `pnpm() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm "$@"; }`.
- TDD: write the test, run it and watch it fail, implement, run it and watch it pass, commit.
- Full suite (`pnpm test`) and `pnpm typecheck` before every commit.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Changing an existing file: read it first; the snippets below show the code to add or replace. Keep everything else unchanged.
- A task that changes canonical trace output (new event kinds, threat events) updates the pinned fingerprint in `packages/engine/test/run.test.ts` deliberately and says so in the commit message.

## File map (new and changed)

```
docs/sources.md, docs/adaptations.md, docs/research/festergut-azerothcore.md   (updated)
docs/howto/extract-client-data.md                                             (new)
packages/data/src/dbc/wdbc.ts          WDBC file parser (browser-safe)
packages/data/src/dbc/spell.ts         spell DBC formats, column table, decoding
packages/data/test/dbc-builder.ts      builds synthetic WDBC files for tests
packages/tools/                        @raid/tools: extract.ts (logic), extract-cli.ts (Node)
packages/engine/src/units.ts           level, armor, avoidance, melee stats, threat multiplier
packages/engine/src/movement.ts        meleeRange / withinMeleeRange
packages/engine/src/threat.ts          ThreatManager (new)
packages/engine/src/melee.ts           armor reduction, creature melee damage, swings (new)
packages/engine/src/modifiers.ts       aura-driven damage multipliers (new)
packages/engine/src/catalog.ts         permanent auras, stack scope, modifiers, scripts, taunt effect
packages/engine/src/auras.ts, effects.ts, casting.ts, boss.ts, rules.ts, run.ts, sim.ts, trace.ts, view.ts, core-data.ts
packages/content/                      @raid/content: training dummy encounter + registry (new)
packages/cli/                          @raid/cli: raid-sim run, golden runs (new)
scenarios/training-dummy/              plan.yaml, clean.yaml (new)
scenarios/golden.json                  pinned trace fingerprints (new)
```

---

### Task 0: Sources and research notes

**Files:** Modify `docs/sources.md`, `docs/research/festergut-azerothcore.md`.

- [ ] **Step 1: Extend the "Files referenced so far" table in `docs/sources.md`** with these rows:

```markdown
| `src/server/shared/DataStores/DBCfmt.h` lines 108–117 | DBC column formats (`packages/data/src/dbc/spell.ts`) |
| `src/server/shared/DataStores/DBCStructure.h` `struct SpellEntry` (line 1677) | Spell DBC column names and order |
| `src/server/game/Combat/ThreatManager.cpp`, `ThreatManager.h` line 94 | Victim selection, taunt, healing threat, 1 s threat update (`threat.ts`) |
| `src/server/game/Entities/Unit/Unit.cpp` lines 807–811, 2233–2300, 8204, 13306 | Melee range, armor reduction, healing threat, attack-power multiplier |
| `src/server/game/Entities/Unit/StatSystem.cpp` line 1117 | Creature melee damage (`melee.ts`) |
| `src/server/game/Entities/Creature/Creature.cpp` line 1554, `CreatureData.h` lines 313–335 | Creature base damage, health, armor |
| `data/sql/base/db_world/creature_template.sql`, `creature_classlevelstats.sql`, `creature_model_info.sql`, `creature_template_model.sql`, `creature.sql` | Festergut stats, size and spawn (Plan 2b) |
```

- [ ] **Step 2: Append to `docs/research/festergut-azerothcore.md`:**

```markdown
## Spell.dbc columns (3.3.5a)

Derived by aligning `SpellEntryfmt` (DBCfmt.h line 112, 234 columns, 187 not skipped) with the
fields of `struct SpellEntry` in order (187 scalars). Zero-based column indexes:

Id 0, Attributes 4, AttributesEx 5, CastingTimeIndex 28, RecoveryTime 29, CategoryRecoveryTime 30,
InterruptFlags 31, AuraInterruptFlags 32, ProcFlags 34, ProcChance 35, DurationIndex 40,
RangeIndex 46, Speed 47 (float), StackAmount 49, Effect[0..2] 71–73, EffectDieSides 74–76,
EffectBasePoints 80–82, EffectImplicitTargetA 86–88, EffectImplicitTargetB 89–91,
EffectRadiusIndex 92–94, EffectApplyAuraName 95–97, EffectAmplitude 98–100,
EffectChainTarget 104–106, EffectMiscValue 110–112, EffectTriggerSpell 116–118,
SpellName[0] 136 (string), StartRecoveryCategory 205, StartRecoveryTime 206,
MaxAffectedTargets 212, DmgClass 213, SchoolMask 225.

Other formats: SpellCastTimes `nixx`, SpellDifficulty `niiii` (10n, 25n, 10h, 25h spell ids),
SpellDuration `niii` (base, per level, max), SpellRadius `nfff` (radius, per level, max),
SpellRange `nffff i …` (min hostile, min friendly, max hostile, max friendly, flags).

## Melee worked example (Festergut 10n)

AP/14 × variance = 805/14 × 1 = 57.5; attack-time multiplier 2000/1000 = 2.0.
min = (177.074 + 57.5) × 75 × 2.0 = 35,186.1 → 35,186; max = (1.5 × 177.074 + 57.5) × 75 × 2.0 =
48,466.65 → 48,466 (truncated to whole numbers before the roll).

## Threat update

`THREAT_UPDATE_INTERVAL` is 1000 ms (ThreatManager.h line 94): the victim is reselected once per
second, immediately after a taunt (ThreatManager.cpp ~583), and immediately when the current
victim becomes unavailable (`GetCurrentVictim`, ~266).
```

- [ ] **Step 3: Commit**

```bash
git add docs/sources.md docs/research/festergut-azerothcore.md
git commit -m "docs: sources and research notes for plan 2a

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: WDBC parser

A WDBC file is a 20-byte header (`WDBC`, record count, field count, record size, string block size), fixed-size records, then a string block. AzerothCore describes each file with a format string: `n` index (uint32), `i` int32, `f` float32, `s` string offset (uint32), `x` and `d` skipped 4 bytes, `b` uint8, `X` skipped byte.

**Files:**
- Create: `packages/data/src/dbc/wdbc.ts`, `packages/data/test/dbc-builder.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/test/wdbc.test.ts`

- [ ] **Step 1: Write the test helper** `packages/data/test/dbc-builder.ts`:

```ts
/** Builds a WDBC file for tests. Missing values default to 0 (or '' for strings). */
export function buildWdbc(fmt: string, records: readonly (readonly (number | string)[])[]): Uint8Array {
  const encoder = new TextEncoder();
  const strings: number[] = [0];
  const offsets = new Map<string, number>([['', 0]]);
  const offsetOf = (s: string): number => {
    const known = offsets.get(s);
    if (known !== undefined) return known;
    const off = strings.length;
    strings.push(...encoder.encode(s), 0);
    offsets.set(s, off);
    return off;
  };
  const width = [...fmt].reduce((n, c) => n + (c === 'b' || c === 'X' ? 1 : 4), 0);
  const body = new Uint8Array(records.length * width);
  const view = new DataView(body.buffer);
  records.forEach((rec, r) => {
    let o = r * width;
    [...fmt].forEach((c, i) => {
      const v = rec[i] ?? (c === 's' ? '' : 0);
      if (c === 'b' || c === 'X') {
        view.setUint8(o, Number(v));
        o += 1;
      } else if (c === 'f') {
        view.setFloat32(o, Number(v), true);
        o += 4;
      } else if (c === 's') {
        view.setUint32(o, offsetOf(String(v)), true);
        o += 4;
      } else if (c === 'n') {
        view.setUint32(o, Number(v), true);
        o += 4;
      } else {
        view.setInt32(o, Number(v), true);
        o += 4;
      }
    });
  });
  const header = new DataView(new ArrayBuffer(20));
  header.setUint32(0, 0x43424457, true);
  header.setUint32(4, records.length, true);
  header.setUint32(8, fmt.length, true);
  header.setUint32(12, width, true);
  header.setUint32(16, strings.length, true);
  const out = new Uint8Array(20 + body.length + strings.length);
  out.set(new Uint8Array(header.buffer), 0);
  out.set(body, 20);
  out.set(Uint8Array.from(strings), 20 + body.length);
  return out;
}
```

- [ ] **Step 2: Write the failing test** `packages/data/test/wdbc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DbcFormatError, parseWdbc } from '../src/dbc/wdbc';
import { buildWdbc } from './dbc-builder';

describe('parseWdbc', () => {
  it('reads index, signed ints, floats and strings; skipped columns are null', () => {
    const file = buildWdbc('nifsx', [
      [7, -5, 1.5, 'Gas Spore', 99],
      [9, 3, 0.25, '', 0],
    ]);
    const t = parseWdbc(file, 'nifsx');
    expect(t.recordCount).toBe(2);
    expect(t.rows.get(7)).toEqual([7, -5, 1.5, 'Gas Spore', null]);
    expect(t.rows.get(9)).toEqual([9, 3, 0.25, '', null]);
  });

  it('handles byte columns', () => {
    const t = parseWdbc(buildWdbc('nbX', [[1, 200, 3]]), 'nbX');
    expect(t.rows.get(1)).toEqual([1, 200, null]);
  });

  it('rejects a wrong magic, a wrong field count, a wrong record size, truncation and duplicates', () => {
    const good = buildWdbc('ni', [[1, 2]]);
    const badMagic = good.slice();
    badMagic[0] = 0;
    expect(() => parseWdbc(badMagic, 'ni')).toThrow(DbcFormatError);
    expect(() => parseWdbc(good, 'nii')).toThrow(/format has 3 fields, file has 2/);
    expect(() => parseWdbc(good, 'nb')).toThrow(/record size/);
    expect(() => parseWdbc(good.slice(0, good.length - 2), 'ni')).toThrow(/truncated/);
    expect(() => parseWdbc(buildWdbc('ni', [[1, 2], [1, 3]]), 'ni')).toThrow(/duplicate id 1/);
    expect(() => parseWdbc(good, 'nq')).toThrow(/unknown format character q/);
    expect(() => parseWdbc(new Uint8Array(5), 'ni')).toThrow(/too short/);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test packages/data/test/wdbc.test.ts`
Expected: FAIL, cannot resolve `../src/dbc/wdbc`.

- [ ] **Step 4: Write the implementation** `packages/data/src/dbc/wdbc.ts`:

```ts
export type DbcValue = number | string;
export type DbcRow = readonly (DbcValue | null)[];

export interface DbcTable {
  readonly recordCount: number;
  readonly fieldCount: number;
  readonly recordSize: number;
  /** Rows keyed by the value of the `n` (index) column. */
  readonly rows: ReadonlyMap<number, DbcRow>;
}

export class DbcFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbcFormatError';
  }
}

const WDBC_MAGIC = 0x43424457; // "WDBC" read as a little-endian uint32

function fieldWidth(c: string): number {
  if (c === 'b' || c === 'X') return 1;
  if (c === 'n' || c === 'i' || c === 'f' || c === 's' || c === 'x' || c === 'd') return 4;
  throw new DbcFormatError(`unknown format character ${c}`);
}

/** Parses a WDBC file using an AzerothCore format string (DBCfmt.h). */
export function parseWdbc(bytes: Uint8Array, fmt: string): DbcTable {
  if (bytes.byteLength < 20) throw new DbcFormatError('file too short for a WDBC header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== WDBC_MAGIC) throw new DbcFormatError('not a WDBC file');
  const recordCount = view.getUint32(4, true);
  const fieldCount = view.getUint32(8, true);
  const recordSize = view.getUint32(12, true);
  const stringSize = view.getUint32(16, true);
  const chars = [...fmt];
  const width = chars.reduce((n, c) => n + fieldWidth(c), 0);
  if (chars.length !== fieldCount) throw new DbcFormatError(`format has ${chars.length} fields, file has ${fieldCount}`);
  if (width !== recordSize) throw new DbcFormatError(`format record size ${width} does not match file record size ${recordSize}`);
  const indexColumn = chars.indexOf('n');
  if (indexColumn < 0) throw new DbcFormatError('format has no index column (n)');
  const stringStart = 20 + recordCount * recordSize;
  if (stringStart + stringSize > bytes.byteLength) throw new DbcFormatError('file is truncated');
  const decoder = new TextDecoder('utf-8');
  const readString = (offset: number): string => {
    if (offset >= stringSize) throw new DbcFormatError(`string offset ${offset} outside the string block`);
    let end = stringStart + offset;
    while (end < stringStart + stringSize && bytes[end] !== 0) end++;
    return decoder.decode(bytes.subarray(stringStart + offset, end));
  };
  const rows = new Map<number, DbcRow>();
  for (let r = 0; r < recordCount; r++) {
    let o = 20 + r * recordSize;
    const row: (DbcValue | null)[] = [];
    for (const c of chars) {
      switch (c) {
        case 'n':
          row.push(view.getUint32(o, true));
          break;
        case 'i':
          row.push(view.getInt32(o, true));
          break;
        case 'f':
          row.push(view.getFloat32(o, true));
          break;
        case 's':
          row.push(readString(view.getUint32(o, true)));
          break;
        case 'b':
          row.push(view.getUint8(o));
          break;
        default:
          row.push(null);
      }
      o += fieldWidth(c);
    }
    const id = row[indexColumn] as number;
    if (rows.has(id)) throw new DbcFormatError(`duplicate id ${id}`);
    rows.set(id, row);
  }
  return { recordCount, fieldCount, recordSize, rows };
}
```

Append to `packages/data/src/index.ts`:

```ts
export * from './dbc/wdbc';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test packages/data/test/wdbc.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/data
git commit -m "feat(data): WDBC parser driven by AzerothCore format strings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Spell DBC decoding

**Files:**
- Create: `packages/data/src/dbc/spell.ts`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/test/spell-dbc.test.ts`

- [ ] **Step 1: Write the failing test** `packages/data/test/spell-dbc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DBC_FORMATS, SPELL_COLUMNS, decodeSpell, difficultyVariants, loadClientSpellData } from '../src/dbc/spell';
import { buildWdbc } from './dbc-builder';

function spellRow(values: Partial<Record<keyof typeof SPELL_COLUMNS, number | string>>, effects: Record<number, Record<string, number>> = {}): (number | string)[] {
  const row: (number | string)[] = Array.from({ length: DBC_FORMATS.Spell.length }, (_, i) => (DBC_FORMATS.Spell[i] === 's' ? '' : 0));
  for (const [k, v] of Object.entries(values)) row[SPELL_COLUMNS[k as keyof typeof SPELL_COLUMNS]] = v!;
  for (const [i, e] of Object.entries(effects)) for (const [k, v] of Object.entries(e)) row[SPELL_COLUMNS[k as keyof typeof SPELL_COLUMNS] + Number(i)] = v;
  return row;
}

describe('spell DBC layout', () => {
  it('has the AzerothCore 3.3.5a spell format (234 columns)', () => {
    expect(DBC_FORMATS.Spell).toHaveLength(234);
    expect([...DBC_FORMATS.Spell].filter((c) => c !== 'x')).toHaveLength(187);
  });

  it('points every column at the right column type', () => {
    const fmt = DBC_FORMATS.Spell;
    expect(fmt[SPELL_COLUMNS.id]).toBe('n');
    expect(fmt[SPELL_COLUMNS.speed]).toBe('f');
    expect(fmt[SPELL_COLUMNS.name]).toBe('s');
    for (const k of ['effect', 'effectBasePoints', 'effectRadiusIndex', 'effectTriggerSpell', 'effectAmplitude'] as const) {
      for (let i = 0; i < 3; i++) expect(fmt[SPELL_COLUMNS[k] + i], `${k}[${i}]`).toBe('i');
    }
    for (const k of ['durationIndex', 'rangeIndex', 'castingTimeIndex', 'maxAffectedTargets', 'schoolMask', 'stackAmount'] as const) {
      expect(fmt[SPELL_COLUMNS[k]], k).toBe('i');
    }
  });
});

describe('decoding', () => {
  it('decodes a spell row and its effects', () => {
    const row = spellRow(
      { id: 69278, name: 'Gas Spore', durationIndex: 9, schoolMask: 8, maxAffectedTargets: 3, castingTimeIndex: 1 },
      { 0: { effect: 6, effectApplyAuraName: 4, effectBasePoints: -1, effectTriggerSpell: 69279, effectRadiusIndex: 13 } },
    );
    const s = decodeSpell(row);
    expect(s).toMatchObject({ id: 69278, name: 'Gas Spore', durationIndex: 9, schoolMask: 8, maxAffectedTargets: 3 });
    expect(s.effects[0]).toMatchObject({ effect: 6, applyAuraName: 4, basePoints: -1, triggerSpell: 69279, radiusIndex: 13 });
    expect(s.effects[1].effect).toBe(0);
  });

  it('loads all six files and finds difficulty variants', () => {
    const data = loadClientSpellData({
      Spell: buildWdbc(DBC_FORMATS.Spell, [spellRow({ id: 69278, name: 'Gas Spore' })]),
      SpellCastTimes: buildWdbc(DBC_FORMATS.SpellCastTimes, [[1, 0]]),
      SpellDifficulty: buildWdbc(DBC_FORMATS.SpellDifficulty, [[500, 69278, 69279, 69280, 69281]]),
      SpellDuration: buildWdbc(DBC_FORMATS.SpellDuration, [[9, 12000, 0, 12000]]),
      SpellRadius: buildWdbc(DBC_FORMATS.SpellRadius, [[13, 8, 0, 8]]),
      SpellRange: buildWdbc(DBC_FORMATS.SpellRange, [[6, 0, 0, 100, 100, 0]]),
    });
    expect(data.spells.get(69278)?.name).toBe('Gas Spore');
    expect(data.radius.get(13)).toEqual({ radius: 8, perLevel: 0, max: 8 });
    expect(data.duration.get(9)).toEqual({ base: 12000, perLevel: 0, max: 12000 });
    expect(data.castTimes.get(1)).toEqual({ castTime: 0 });
    expect(data.ranges.get(6)).toEqual({ minHostile: 0, minFriendly: 0, maxHostile: 100, maxFriendly: 100, flags: 0 });
    expect(difficultyVariants(data, 69280)).toEqual([69278, 69279, 69280, 69281]);
    expect(difficultyVariants(data, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/data/test/spell-dbc.test.ts`
Expected: FAIL, cannot resolve `../src/dbc/spell`.

- [ ] **Step 3: Write the implementation** `packages/data/src/dbc/spell.ts`:

```ts
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
```

Append to `packages/data/src/index.ts`:

```ts
export * from './dbc/spell';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/data`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data
git commit -m "feat(data): spell DBC formats, column table and decoding

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Spell extraction tool

The tool reads the six DBC files from a folder, pins each by SHA-256, follows triggered spells and difficulty variants from a list of root spell ids, and writes a JSON file of exactly those spells. That JSON is committed (factual values only); the DBC files never are.

**Files:**
- Create: `packages/tools/package.json`, `packages/tools/src/extract.ts`, `packages/tools/src/extract-cli.ts`
- Modify: root `package.json` (devDependency `tsx`, script `extract-spells`)
- Test: `packages/tools/test/extract.test.ts`

- [ ] **Step 1: Package and script**

`packages/tools/package.json`:
```json
{
  "name": "@raid/tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-only",
  "exports": { ".": "./src/extract.ts" },
  "dependencies": { "@raid/data": "workspace:*" }
}
```

In the root `package.json` add `"tsx": "4.19.2"` to `devDependencies` and this script:
```json
"extract-spells": "tsx packages/tools/src/extract-cli.ts"
```

Run: `pnpm install`
Expected: `Done`.

- [ ] **Step 2: Write the failing test** `packages/tools/test/extract.test.ts`:

```ts
import { DBC_FORMATS, SPELL_COLUMNS, loadClientSpellData } from '@raid/data';
import { describe, expect, it } from 'vitest';
import { buildWdbc } from '../../data/test/dbc-builder';
import { dataVersionOf, extractSpells } from '../src/extract';

function spell(id: number, name: string, triggers: number[] = []): (number | string)[] {
  const row: (number | string)[] = Array.from({ length: DBC_FORMATS.Spell.length }, (_, i) => (DBC_FORMATS.Spell[i] === 's' ? '' : 0));
  row[SPELL_COLUMNS.id] = id;
  row[SPELL_COLUMNS.name] = name;
  row[SPELL_COLUMNS.durationIndex] = 9;
  row[SPELL_COLUMNS.rangeIndex] = 6;
  triggers.forEach((t, i) => {
    row[SPELL_COLUMNS.effect + i] = 64;
    row[SPELL_COLUMNS.effectTriggerSpell + i] = t;
    row[SPELL_COLUMNS.effectRadiusIndex + i] = 13;
  });
  return row;
}

function data() {
  return loadClientSpellData({
    Spell: buildWdbc(DBC_FORMATS.Spell, [spell(100, 'Root', [200]), spell(200, 'Triggered'), spell(101, 'Root 25'), spell(300, 'Unrelated')]),
    SpellCastTimes: buildWdbc(DBC_FORMATS.SpellCastTimes, [[1, 0]]),
    SpellDifficulty: buildWdbc(DBC_FORMATS.SpellDifficulty, [[7, 100, 101, 0, 0]]),
    SpellDuration: buildWdbc(DBC_FORMATS.SpellDuration, [[9, 12000, 0, 12000]]),
    SpellRadius: buildWdbc(DBC_FORMATS.SpellRadius, [[13, 8, 0, 8]]),
    SpellRange: buildWdbc(DBC_FORMATS.SpellRange, [[6, 0, 0, 100, 100, 0]]),
  });
}

const files = [{ name: 'Spell.dbc', sha256: 'a'.repeat(64), dataVersion: dataVersionOf('Spell.dbc', 'a'.repeat(64)) }];

describe('extractSpells', () => {
  it('follows triggered spells and difficulty variants, and nothing else', () => {
    const x = extractSpells(data(), files, [100]);
    expect(x.spells.map((s) => s.id)).toEqual([100, 101, 200]);
    expect(x.missing).toEqual([]);
  });

  it('resolves durations, ranges and effect radii through their index tables', () => {
    const root = extractSpells(data(), files, [100]).spells[0];
    expect(root.durationMs).toEqual({ base: 12000, perLevel: 0, max: 12000 });
    expect(root.rangeYd).toEqual({ minHostile: 0, minFriendly: 0, maxHostile: 100, maxFriendly: 100 });
    expect(root.effects).toHaveLength(1);
    expect(root.effects[0]).toMatchObject({ index: 0, effect: 64, triggerSpell: 200, radiusYd: { radius: 8, max: 8 } });
    expect(root.difficultyVariants).toEqual([100, 101, 0, 0]);
  });

  it('reports ids that are not in the client data', () => {
    expect(extractSpells(data(), files, [100, 999]).missing).toEqual([999]);
  });

  it('builds version strings from the file name and hash prefix', () => {
    expect(dataVersionOf('Spell.dbc', 'abcdef0123456789'.repeat(4))).toBe('client-12340:Spell.dbc:abcdef012345');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test packages/tools`
Expected: FAIL, cannot resolve `../src/extract`.

- [ ] **Step 4: Write `packages/tools/src/extract.ts`**

```ts
import { difficultyVariants, type ClientSpellData } from '@raid/data';

export interface ExtractedFile {
  readonly name: string;
  readonly sha256: string;
  readonly dataVersion: string;
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
}

export interface ExtractedSpell {
  readonly id: number;
  readonly name: string;
  readonly attributes: number;
  readonly attributesEx: number;
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
      });
    });
    const range = data.ranges.get(s.rangeIndex);
    out.push({
      id: s.id,
      name: s.name,
      attributes: s.attributes,
      attributesEx: s.attributesEx,
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
```

- [ ] **Step 5: Write `packages/tools/src/extract-cli.ts`** (no unit test; exercised by the owner in Plan 2b):

```ts
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test packages/tools && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml packages/tools
git commit -m "feat(tools): extract client spell data with pinned file hashes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: How-to for the owner's extraction

**Files:** Create `docs/howto/extract-client-data.md`.

- [ ] **Step 1: Write the document**

```markdown
# Extracting spell data from your WotLK client

This is done once, on your own machine, with your own 3.3.5a (build 12340) client. The `.dbc`
files are Blizzard game data and are never committed; only the numbers we need end up in the repo.

## 1. Get the six DBC files

You need these files from the client's `DBFilesClient` folder (inside the client's MPQ archives):
`Spell.dbc`, `SpellCastTimes.dbc`, `SpellDifficulty.dbc`, `SpellDuration.dbc`, `SpellRadius.dbc`,
`SpellRange.dbc`.

Two common ways:
- **AzerothCore's extractor**: the `map_extractor` tool from an AzerothCore build writes all DBC files
  of a client into a `dbc` folder (it is the same tool server owners use, so the files are exactly what
  the server reads).
- **An MPQ editor**: open the client's `Data/<locale>/` archives (the locale archive and its patch
  archives, applied in order) and export `DBFilesClient/<name>.dbc`. The latest patch archive's copy
  wins.

Put the six files into one folder outside the repository, for example `C:\wow-dbc\`.

## 2. Run the extraction

    pnpm extract-spells --dbc C:\wow-dbc --spells <spell ids> --out packages/content/data/spelldata/festergut.json

Plan 2b lists the Festergut spell ids. The command prints one version string per file, for example
`client-12340:Spell.dbc:0123456789ab`, and any id it could not find.

## 3. Pin the versions

Add the printed version strings to `PINS.spellDataVersions` in `packages/data/src/pins.ts` and to the
"Spell data" section of `docs/sources.md` together with the full SHA-256 hashes, then commit the JSON
file and both changes. From then on, every `spelldata` source in the content must name one of these
versions, or the data check fails.
```

- [ ] **Step 2: Commit**

```bash
git add docs/howto/extract-client-data.md
git commit -m "docs: how to extract spell data from the client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Combat fields on units and melee range

**Files:**
- Modify: `packages/engine/src/units.ts`, `packages/engine/src/movement.ts`
- Test: `packages/engine/test/combat-fields.test.ts`

- [ ] **Step 1: Write the failing test** `packages/engine/test/combat-fields.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { meleeRange, withinMeleeRange } from '../src/movement';
import { createUnit } from '../src/units';

const base = { kind: 'player' as const, role: 'tank' as const, maxHealth: 1000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

describe('combat fields', () => {
  it('defaults level 80, no armor, no avoidance, no melee, threat multiplier 1', () => {
    const u = createUnit({ ...base, id: 'p1', name: 'P1', pos: { x: 0, y: 0 } });
    expect(u).toMatchObject({ level: 80, armor: 0, avoidance: { missPct: 0, dodgePct: 0, parryPct: 0 }, melee: null, threatMultiplier: 1, nextSwingMs: 0 });
  });

  it('validates combat fields', () => {
    const mk = (extra: object) => () => createUnit({ ...base, id: 'p1', name: 'P1', pos: { x: 0, y: 0 }, ...extra });
    expect(mk({ level: 0 })).toThrow(/level/);
    expect(mk({ armor: -1 })).toThrow(/armor/);
    expect(mk({ avoidance: { missPct: 60, dodgePct: 30, parryPct: 20 } })).toThrow(/avoidance/);
    expect(mk({ melee: { minDamage: 10, maxDamage: 5, attackTimeMs: 2000 } })).toThrow(/melee/);
    expect(mk({ melee: { minDamage: 1, maxDamage: 5, attackTimeMs: 0 } })).toThrow(/melee/);
    expect(mk({ threatMultiplier: Number.NaN })).toThrow(/threat multiplier/);
  });
});

describe('melee range (Unit::GetMeleeRange)', () => {
  const boss = createUnit({ ...base, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', combatReach: 8, pos: { x: 0, y: 0 } });
  const tank = createUnit({ ...base, id: 't1', name: 'T1', pos: { x: 10.8, y: 0 } });
  const far = createUnit({ ...base, id: 't2', name: 'T2', pos: { x: 10.9, y: 0 } });
  const p1 = createUnit({ ...base, id: 'p1', name: 'P1', pos: { x: 0, y: 0 } });
  const p2 = createUnit({ ...base, id: 'p2', name: 'P2', pos: { x: 0, y: 0 } });

  it('is both reaches plus 4/3, at least 5 yd, centre to centre', () => {
    expect(meleeRange(boss, tank)).toBeCloseTo(8 + 1.5 + 4 / 3, 10);
    expect(meleeRange(p1, p2)).toBe(5);
    expect(withinMeleeRange(boss, tank, 0)).toBe(true);
    expect(withinMeleeRange(boss, far, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/combat-fields.test.ts`
Expected: FAIL (`meleeRange` not exported; unit fields missing).

- [ ] **Step 3: Implement**

In `packages/engine/src/units.ts` add these types next to `Vec2`:

```ts
export interface Avoidance {
  readonly missPct: number;
  readonly dodgePct: number;
  readonly parryPct: number;
}

export interface MeleeStats {
  readonly minDamage: number;
  readonly maxDamage: number;
  readonly attackTimeMs: number;
}

export const NO_AVOIDANCE: Avoidance = Object.freeze({ missPct: 0, dodgePct: 0, parryPct: 0 });
```

Add to `interface Unit` (after `boundingRadius`):

```ts
  readonly level: number;
  readonly armor: number;
  readonly avoidance: Avoidance;
  /** Auto-attack stats; null for units that do not swing (players until Plan 3). */
  readonly melee: MeleeStats | null;
  /** Multiplier on threat from this unit's damage (stances, presences). */
  readonly threatMultiplier: number;
  /** Earliest time of the next melee swing. */
  nextSwingMs: number;
```

Add to `interface UnitInit` (all optional):

```ts
  readonly level?: number;
  readonly armor?: number;
  readonly avoidance?: Avoidance;
  readonly melee?: MeleeStats | null;
  readonly threatMultiplier?: number;
```

In `createUnit`, before the `return`, add the validation, and set the fields in the returned object:

```ts
  const level = init.level ?? 80;
  const armor = init.armor ?? 0;
  const avoidance = init.avoidance ?? NO_AVOIDANCE;
  const melee = init.melee ?? null;
  const threatMultiplier = init.threatMultiplier ?? 1;
  if (!Number.isInteger(level) || level < 1 || level > 83) throw new Error(`invalid level ${level} for ${init.id}`);
  if (!Number.isFinite(armor) || armor < 0) throw new Error(`invalid armor ${armor} for ${init.id}`);
  const av = [avoidance.missPct, avoidance.dodgePct, avoidance.parryPct];
  if (av.some((v) => !Number.isFinite(v) || v < 0) || av.reduce((a, b) => a + b, 0) > 100) {
    throw new Error(`invalid avoidance for ${init.id}`);
  }
  if (
    melee &&
    (!Number.isFinite(melee.minDamage) || melee.minDamage < 0 || !(melee.maxDamage >= melee.minDamage) ||
      !Number.isInteger(melee.attackTimeMs) || melee.attackTimeMs <= 0)
  ) {
    throw new Error(`invalid melee stats for ${init.id}`);
  }
  if (!Number.isFinite(threatMultiplier) || threatMultiplier < 0) throw new Error(`invalid threat multiplier for ${init.id}`);
```

and in the returned object literal:

```ts
    level,
    armor,
    avoidance: { ...avoidance },
    melee: melee ? { ...melee } : null,
    threatMultiplier,
    nextSwingMs: 0,
```

In `packages/engine/src/movement.ts` add:

```ts
/** AzerothCore NOMINAL_MELEE_RANGE (ObjectDefines.h line 47). */
export const NOMINAL_MELEE_RANGE_YD = 5;

/** AzerothCore Unit::GetMeleeRange (Unit.cpp lines 807–811): both combat reaches + 4/3, at least 5 yd, centre to centre. */
export function meleeRange(a: Unit, b: Unit): number {
  return Math.max(a.combatReach + b.combatReach + 4 / 3, NOMINAL_MELEE_RANGE_YD);
}

/** Without AzerothCore's leeway bonus for two moving units (adaptation A-022). */
export function withinMeleeRange(a: Unit, b: Unit, t: number): boolean {
  return centerDistance(positionAt(a, t), positionAt(b, t)) <= meleeRange(a, b);
}
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. (Hand-built `Unit` objects in tests, if any, need the new fields; fix them by adding the defaults shown above.)

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): unit level, armor, avoidance, melee stats, threat multiplier; melee range

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Threat manager

Replaces the placeholder `Unit.threat` map with AzerothCore's model (research notes, "Threat"): threat lists per creature, damage threat × the source's multiplier, healing threat half split over every creature that has the healed unit listed, victim reselection once per second with the 110 %/130 %/melee rules, immediately when the victim dies, and immediately on taunt (Task 7).

**Files:**
- Create: `packages/engine/src/threat.ts`
- Modify: `packages/engine/src/units.ts` (remove `threat`), `packages/engine/src/boss.ts` (`victimOf`), `packages/engine/src/trace.ts` (event kind `threat_target`), `packages/engine/src/core-data.ts`, `packages/engine/src/run.ts`, `packages/engine/src/index.ts`, `packages/format/src/en.ts`
- Modify tests: `packages/engine/test/boss.test.ts`, `packages/engine/test/rules.test.ts`, `packages/engine/test/fixtures/dummy-boss.ts`, `packages/engine/test/run.test.ts`
- Test: `packages/engine/test/threat.test.ts`

- [ ] **Step 1: Write the failing test** `packages/engine/test/threat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { ThreatManager, threatFor } from '../src/threat';

const player = { kind: 'player' as const, maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 1, maxDurationMs: 10000, sampleIntervalMs: 1000 });
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 8, boundingRadius: 0.31 });
  sim.addUnit({ ...player, id: 't1', name: 'T1', role: 'tank', pos: { x: 10, y: 0 } });
  sim.addUnit({ ...player, id: 'm1', name: 'M1', role: 'melee', pos: { x: -10, y: 0 } });
  sim.addUnit({ ...player, id: 'r1', name: 'R1', role: 'ranged', pos: { x: 30, y: 0 }, threatMultiplier: 2 });
  sim.addUnit({ ...player, id: 'h1', name: 'H1', role: 'healer', pos: { x: 0, y: 30 } });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  return { sim, threat };
}

const hit = (src: string) => ({ sourceId: src, ability: 'x', school: 'physical' as const });
const targets = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'threat_target').map((e) => [e.t, e.data.target]);

describe('ThreatManager', () => {
  it('the first unit on an empty list becomes the victim at once', () => {
    const { sim, threat } = newSim();
    threat.add('boss', 't1', 100);
    threat.add('boss', 'm1', 0);
    expect(threat.victim('boss')?.id).toBe('t1');
    expect(threatFor(sim)).toBe(threat);
  });

  it('damage threat uses the source multiplier; healing threat is half, split over listed creatures', () => {
    const { sim, threat } = newSim();
    threat.add('boss', 't1', 0);
    sim.at(10, EventClass.SpellHit, () => {
      sim.damage('boss', 1000, hit('r1'), []);
      sim.damage('t1', 500, hit('boss'), []);
      sim.heal('t1', 400, hit('h1'), []);
    });
    sim.run();
    expect(threat.threatOf('boss', 'r1')).toBe(2000);
    expect(threat.threatOf('boss', 'h1')).toBe(200);
  });

  it('keeps the victim below 110 %, switches above 130 %, and between only to a melee target', () => {
    const { sim, threat } = newSim();
    threat.add('boss', 't1', 1000);
    sim.at(100, EventClass.SpellHit, () => {
      threat.add('boss', 'm1', 1050); // 105 %: stays on t1
      threat.add('boss', 'r1', 1200); // 120 %, ranged: stays on t1 (m1 is below 110 %)
    });
    sim.at(1100, EventClass.SpellHit, () => threat.add('boss', 'm1', 100)); // m1 1150: 115 %, melee → takes over at the next update
    sim.at(2100, EventClass.SpellHit, () => threat.add('boss', 'r1', 400)); // r1 1600: > 130 % of 1150 → takes over
    sim.run();
    expect(targets(sim)).toEqual([
      [0, 't1'],
      [2000, 'm1'],
      [3000, 'r1'],
    ]);
  });

  it('reselects at once when the victim dies', () => {
    const { sim, threat } = newSim();
    threat.add('boss', 't1', 1000);
    threat.add('boss', 'm1', 10);
    sim.at(500, EventClass.SpellHit, () => {
      sim.damage('t1', 1e6, hit('boss'), []);
      expect(threat.victim('boss')?.id).toBe('m1');
    });
    sim.run();
  });

  it('only living players go onto living creatures; ties go to the lowest id', () => {
    const { threat } = newSim();
    expect(() => threat.add('t1', 'boss', 1)).toThrow(/players onto creatures/);
    threat.add('boss', 'm1', 5);
    threat.add('boss', 'h1', 5);
    expect(threat.listed('boss').map((u) => u.id)).toEqual(['h1', 'm1']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/threat.test.ts`
Expected: FAIL, cannot resolve `../src/threat`.

- [ ] **Step 3: Write `packages/engine/src/threat.ts`**

```ts
import { withinMeleeRange } from './movement';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import type { TraceEvent } from './trace';
import { compareStrings, type Unit } from './units';

interface Ref {
  threat: number;
  tauntSeq: number;
  tauntUntilMs: number;
}

interface Entry {
  readonly id: string;
  readonly threat: number;
  readonly taunting: boolean;
}

const managers = new WeakMap<Simulation, ThreatManager>();

/** The threat manager installed for a simulation, if any. */
export function threatFor(sim: Simulation): ThreatManager | undefined {
  return managers.get(sim);
}

/** AzerothCore-style threat (ThreatManager.cpp at the pinned commit; adaptation A-019). */
export class ThreatManager {
  private readonly lists = new Map<string, Map<string, Ref>>();
  private readonly victims = new Map<string, string>();
  private seq = 0;

  constructor(
    private readonly sim: Simulation,
    private readonly updateIntervalMs: number,
  ) {
    if (!Number.isInteger(updateIntervalMs) || updateIntervalMs <= 0) throw new Error('threat update interval must be a positive integer');
    if (managers.has(sim)) throw new Error('a threat manager is already installed for this simulation');
    managers.set(sim, this);
  }

  install(): void {
    this.sim.subscribe((ev) => this.onEvent(ev));
    const tick = (): void => {
      if (this.sim.over) return;
      for (const id of [...this.lists.keys()].sort(compareStrings)) this.reselect(id, []);
      this.sim.at(this.sim.now + this.updateIntervalMs, EventClass.AiUpdate, tick);
    };
    this.sim.at(this.sim.now + this.updateIntervalMs, EventClass.AiUpdate, tick);
  }

  /** Adds threat; the unit joins the creature's list if needed (amount 0 = zone-in-combat). */
  add(creatureId: string, unitId: string, amount: number, causes: readonly string[] = []): void {
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`invalid threat amount ${amount}`);
    const creature = this.sim.unit(creatureId);
    const unit = this.sim.unit(unitId);
    if (creature.kind !== 'creature' || unit.kind !== 'player') throw new Error(`threat goes from players onto creatures (${unitId} → ${creatureId})`);
    if (!creature.alive || !unit.alive || this.sim.over) return;
    const ref = this.refOf(creatureId, unitId);
    ref.threat += amount;
    if (!this.victimAlive(creatureId)) this.reselect(creatureId, causes);
  }

  threatOf(creatureId: string, unitId: string): number {
    return this.lists.get(creatureId)?.get(unitId)?.threat ?? 0;
  }

  /** Living units on the creature's list, sorted by id. */
  listed(creatureId: string): Unit[] {
    const list = this.lists.get(creatureId);
    if (!list) return [];
    return [...list.keys()].sort(compareStrings).map((id) => this.sim.unit(id)).filter((u) => u.alive);
  }

  victim(creatureId: string): Unit | null {
    if (!this.victimAlive(creatureId)) this.reselect(creatureId, []);
    const id = this.victims.get(creatureId);
    return id ? this.sim.unit(id) : null;
  }

  /**
   * Taunt (MatchUnitThreatToHighestThreat + taunt state): the taunter's threat is raised to the highest
   * threat, it takes precedence until `durationMs` ends, and the victim is reselected now and at the end.
   */
  taunt(creatureId: string, taunterId: string, durationMs: number, causes: readonly string[]): 'ok' | 'dead' | 'not_in_combat' {
    const creature = this.sim.unit(creatureId);
    const taunter = this.sim.unit(taunterId);
    if (!creature.alive || !taunter.alive || this.sim.over) return 'dead';
    const list = this.lists.get(creatureId);
    if (!list) return 'not_in_combat';
    const highest = Math.max(0, ...[...list].filter(([id]) => this.sim.unit(id).alive).map(([, r]) => r.threat));
    const ref = this.refOf(creatureId, taunterId);
    if (ref.threat < highest) ref.threat = highest;
    ref.tauntSeq = ++this.seq;
    ref.tauntUntilMs = this.sim.now + durationMs;
    const tauntEvent = this.sim.emit('taunt', { boss: creatureId, actor: taunterId, untilMs: ref.tauntUntilMs }, causes);
    this.reselect(creatureId, [tauntEvent]);
    this.sim.at(ref.tauntUntilMs, EventClass.AuraExpiry, () => this.reselect(creatureId, [tauntEvent]));
    return 'ok';
  }

  private refOf(creatureId: string, unitId: string): Ref {
    let list = this.lists.get(creatureId);
    if (!list) this.lists.set(creatureId, (list = new Map()));
    let ref = list.get(unitId);
    if (!ref) list.set(unitId, (ref = { threat: 0, tauntSeq: 0, tauntUntilMs: -1 }));
    return ref;
  }

  private victimAlive(creatureId: string): boolean {
    const id = this.victims.get(creatureId);
    return id !== undefined && this.sim.unit(id).alive;
  }

  private onEvent(ev: TraceEvent): void {
    const d = ev.data;
    if (typeof d.source !== 'string' && ev.kind !== 'death') return;
    if (ev.kind === 'damage' && typeof d.target === 'string') {
      const source = this.sim.unit(d.source as string);
      const target = this.sim.unit(d.target);
      const amount = Number(d.amount);
      if (source.kind === 'player' && target.kind === 'creature' && amount > 0) this.add(target.id, source.id, amount * source.threatMultiplier, [ev.id]);
    } else if (ev.kind === 'heal' && typeof d.target === 'string') {
      const healer = this.sim.unit(d.source as string);
      const amount = Number(d.amount);
      if (healer.kind !== 'player' || !(amount > 0)) return;
      const target = d.target;
      const threatened = [...this.lists.keys()].sort(compareStrings).filter((c) => this.lists.get(c)!.has(target) && this.sim.unit(c).alive);
      if (threatened.length === 0) return;
      const share = amount / 2 / threatened.length; // Unit.cpp 8204: half the healing, split evenly, no modifiers
      for (const c of threatened) this.add(c, healer.id, share, [ev.id]);
    } else if (ev.kind === 'death' && typeof d.unit === 'string') {
      this.lists.delete(d.unit);
      this.victims.delete(d.unit);
    }
  }

  /** Living entries, sorted: the current taunter first, then threat, then id. */
  private entries(creatureId: string): Entry[] {
    const list = this.lists.get(creatureId);
    if (!list) return [];
    const now = this.sim.now;
    let taunter: string | null = null;
    let latest = 0;
    for (const [id, r] of list) {
      if (r.tauntUntilMs > now && r.tauntSeq > latest && this.sim.unit(id).alive) {
        taunter = id;
        latest = r.tauntSeq;
      }
    }
    return [...list]
      .filter(([id]) => this.sim.unit(id).alive)
      .map(([id, r]) => ({ id, threat: r.threat, taunting: id === taunter }))
      .sort((a, b) => Number(b.taunting) - Number(a.taunting) || b.threat - a.threat || compareStrings(a.id, b.id));
  }

  /** CompareReferencesLT: is `a` lower than `b` when a's threat is multiplied by `weight`? */
  private static lower(a: Entry, b: Entry, weight: number): boolean {
    if (a.taunting !== b.taunting) return !a.taunting;
    return a.threat * weight < b.threat;
  }

  /** ReselectVictim (ThreatManager.cpp ~665), without fixate. */
  private choose(creatureId: string): string | null {
    const sorted = this.entries(creatureId);
    if (sorted.length === 0) return null;
    const creature = this.sim.unit(creatureId);
    const now = this.sim.now;
    const old = sorted.find((e) => e.id === this.victims.get(creatureId));
    const highest = sorted[0];
    if (!old || highest.id === old.id) return highest.id;
    if (!ThreatManager.lower(old, highest, 1.1)) return old.id;
    if (ThreatManager.lower(old, highest, 1.3)) return highest.id;
    const melee = (e: Entry) => withinMeleeRange(creature, this.sim.unit(e.id), now);
    if (melee(highest)) return highest.id;
    for (const next of sorted) {
      if (next.id === old.id) return old.id;
      if (!ThreatManager.lower(old, next, 1.1)) return old.id;
      if (melee(next)) return next.id;
    }
    return old.id;
  }

  private reselect(creatureId: string, causes: readonly string[]): void {
    if (!this.sim.unit(creatureId).alive || this.sim.over) return;
    const next = this.choose(creatureId);
    const previous = this.victims.get(creatureId) ?? null;
    if (next === previous) return;
    if (next === null) this.victims.delete(creatureId);
    else this.victims.set(creatureId, next);
    this.sim.emit('threat_target', { boss: creatureId, target: next, previous }, causes);
  }
}
```

- [ ] **Step 4: Wire it in**

1. `packages/engine/src/trace.ts`: add `'threat_target'` and `'taunt'` to `EVENT_KINDS` (after `'timer_window'`).
2. `packages/format/src/en.ts`: add
   `'event.threat_target': '{boss} turns to {target}'` and `'event.taunt': '{actor} taunts {boss}'`.
3. `packages/engine/src/units.ts`: delete the `threat` field from `Unit` and from `createUnit`.
4. `packages/engine/src/boss.ts`: replace the body of `victimOf` with

   ```ts
   export function victimOf(sim: Simulation, bossId: string): Unit | null {
     return threatFor(sim)?.victim(bossId) ?? null;
   }
   ```
   and import `threatFor` from `./threat`.
5. `packages/engine/src/core-data.ts`: add

   ```ts
   {
     key: 'core.threat_update_interval_ms',
     value: 1000,
     source: { kind: 'code', file: 'src/server/game/Combat/ThreatManager.h', commit, line: 94 },
   },
   ```
6. `packages/engine/src/run.ts`: right after `installCoreRules(sim);` create and install the manager:

   ```ts
   const threat = new ThreatManager(sim, data.num('core.threat_update_interval_ms'));
   threat.install();
   ```
   Change the order at the end so the engage event comes first: `rules.install()`, controllers, stand-ins, then `attachBoss(...)`, **then** `setup.pull(sim)` (keep its try/catch). `currentTank` becomes `() => threat.victim(setup.bossUnitId)`.
7. `packages/engine/src/index.ts`: add `export * from './threat';`.

- [ ] **Step 5: Update the tests that used `Unit.threat`**

- `test/fixtures/dummy-boss.ts` `pull`: put the tank on the list first, then everyone else at 0:

  ```ts
  pull(s) {
    const threat = threatFor(s)!;
    const tank = s.players().find((p) => p.role === 'tank');
    if (tank) threat.add('dummy', tank.id, 1);
    for (const p of s.players()) threat.add('dummy', p.id, 0);
  },
  ```
- `test/boss.test.ts`: in `newSim(withVictim)` create `const threat = new ThreatManager(sim, 1000); threat.install();` and replace `sim.unit('boss').threat.set('p1', 100)` with `threat.add('boss', 'p1', 100)`. Delete the test "picks the victim by highest threat…" (now covered by `threat.test.ts`).
- `test/rules.test.ts`: the rule engine only needs *a* current tank. Replace the threat-map based `currentTank` hook with an explicit holder: `const tank = { id: 't1' };` and `currentTank: () => sim.unit(tank.id)`; replace each `sim.unit('boss').threat.set('t2', …)` swap with `tank.id = 't2'` (and back with `tank.id = 't1'`) at the same times. Return `tank` from `newSim` where the tests need it.
- `test/run.test.ts`: the trace now contains `threat_target` events, so the pinned SHA-256 changes. Recompute it once with the new code and replace the pinned value; keep the "first event is engage" assertion (it holds with the new order).

- [ ] **Step 6: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages
git commit -m "feat(engine): AzerothCore threat lists, victim selection and healing threat

The trace gains threat_target events, so the pinned dummy fingerprint is updated.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Taunt

Two ways to taunt: a `taunt` spell effect (for Plan 3's class taunts) and a plan rule action `taunt` (for stand-in tanks and rules). The rule action uses sourced generic values until each spec's own taunt spell is modelled.

**Files:**
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/effects.ts`, `packages/engine/src/rules.ts`, `packages/engine/src/run.ts`, `packages/engine/src/core-data.ts`
- Test: `packages/engine/test/taunt.test.ts`

- [ ] **Step 1: Write the failing test** `packages/engine/test/taunt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyEffects } from '../src/effects';
import { PlanSchema } from '../src/plan/schema';
import { EventClass } from '../src/queue';
import { BUILTIN_ACTIONS, RuleEngine, createTauntAction } from '../src/rules';
import { Simulation } from '../src/sim';
import { ThreatManager } from '../src/threat';

const player = { kind: 'player' as const, maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 1, maxDurationMs: 20000, sampleIntervalMs: 1000 });
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 8, boundingRadius: 0.31 });
  sim.addUnit({ ...player, id: 't1', name: 'T1', role: 'tank', pos: { x: 10, y: 0 } });
  sim.addUnit({ ...player, id: 't2', name: 'T2', role: 'tank', pos: { x: -10, y: 0 } });
  sim.addUnit({ ...player, id: 'far', name: 'Far', role: 'tank', pos: { x: 60, y: 0 } });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  threat.add('boss', 't1', 5000);
  threat.add('boss', 't2', 100);
  threat.add('boss', 'far', 0);
  return { sim, threat };
}

describe('taunt', () => {
  it('a taunt effect takes the victim at once, matches the top threat and holds for its duration', () => {
    const { sim, threat } = newSim();
    sim.at(1000, EventClass.SpellHit, () => applyEffects(sim, [{ type: 'taunt', durationMs: 3000 }], { casterId: 't2', targetId: 'boss', ability: 'taunt', causes: [] }));
    sim.at(1500, EventClass.SpellHit, () => threat.add('boss', 't1', 5000)); // t1 at 200 % during the taunt
    sim.run();
    const victims = sim.trace.list().filter((e) => e.kind === 'threat_target').map((e) => [e.t, e.data.target]);
    expect(victims).toEqual([
      [0, 't1'],
      [1000, 't2'],
      [4000, 't1'],
    ]);
    expect(threat.threatOf('boss', 't2')).toBe(5000);
  });

  it('the rule action checks range and its cooldown', () => {
    const { sim } = newSim();
    const plan = PlanSchema.parse({
      id: 'p',
      boss: 'boss',
      roster: ['t1', 't2', 'far'].map((id) => ({ id, name: id, kind: 'standin', role: 'tank', maxHealth: 100000, ratePerSecond: 0, reaction: { minMs: 0, maxMs: 0 } })),
      spots: { home: { x: 0, y: 0 } },
      phases: [{ phase: 'default', assignments: { t1: 'home', t2: 'home', far: 'home' } }],
      rules: [
        { id: 'swap', who: ['t2', 'far'], when: { on: 'time', atMs: 1000 }, do: { do: 'taunt', target: 'boss' } },
        { id: 'again', who: ['t2'], when: { on: 'time', atMs: 2000 }, do: { do: 'taunt', target: 'boss' } },
      ],
    });
    const actions = new Map([...BUILTIN_ACTIONS, ['taunt', createTauntAction({ rangeYd: 30, cooldownMs: 8000, durationMs: 3000 })]]);
    new RuleEngine(sim, plan, actions, { currentTank: () => null }).install();
    sim.run();
    const failed = sim.trace.list().filter((e) => e.kind === 'action_failed').map((e) => [e.t, e.data.actor, e.data.reason]);
    expect(failed).toEqual([
      [1000, 'far', 'out_of_range'],
      [2000, 't2', 'cooldown'],
    ]);
    expect(sim.trace.list().filter((e) => e.kind === 'taunt').map((e) => [e.t, e.data.actor])).toEqual([[1000, 't2']]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/taunt.test.ts`
Expected: FAIL (`createTauntAction` not exported; `taunt` effect unknown).

- [ ] **Step 3: Implement**

`packages/engine/src/catalog.ts`: add to the `Effect` union

```ts
  | { readonly type: 'taunt'; readonly durationMs: number }
```

`packages/engine/src/effects.ts`: import `threatFor` from `./threat` and add the case

```ts
    case 'taunt':
      threatFor(sim)?.taunt(target.id, ctx.casterId, e.durationMs, ctx.causes);
      return;
```

`packages/engine/src/rules.ts`: add (imports: `edgeDistance` from `./movement`, `threatFor` from `./threat`)

```ts
export interface TauntParams {
  readonly rangeYd: number;
  readonly cooldownMs: number;
  readonly durationMs: number;
}

/** Plan action `taunt` for any actor; cooldown state lives in the returned handler (one per run). */
export function createTauntAction(p: TauntParams): ActionHandler {
  const readyAt = new Map<string, number>();
  return (ctx) => {
    if (ctx.action.do !== 'taunt') return { ok: false, reason: 'wrong_action' };
    const target = ctx.resolve(ctx.action.target);
    if (!target || !target.alive) return { ok: false, reason: 'target_dead' };
    const threat = threatFor(ctx.sim);
    if (!threat) return { ok: false, reason: 'no_threat' };
    if ((readyAt.get(ctx.actor.id) ?? 0) > ctx.sim.now) return { ok: false, reason: 'cooldown' };
    if (edgeDistance(ctx.actor, target, ctx.sim.now) > p.rangeYd) return { ok: false, reason: 'out_of_range' };
    const r = threat.taunt(target.id, ctx.actor.id, p.durationMs, ctx.causes);
    if (r !== 'ok') return { ok: false, reason: r };
    readyAt.set(ctx.actor.id, ctx.sim.now + p.cooldownMs);
    return { ok: true };
  };
}

/** Actions the engine provides in every run (BUILTIN_ACTIONS plus taunt, which needs run data). */
export const ENGINE_ACTION_NAMES: ReadonlySet<string> = new Set([...BUILTIN_ACTIONS.keys(), 'taunt']);
```

`packages/engine/src/core-data.ts`: add three `assumption` entries:

```ts
  {
    key: 'core.taunt_range_yd',
    value: 30,
    source: { kind: 'assumption', rationale: 'generic 3.3.5a tank taunt (Taunt, Hand of Reckoning, Dark Command, Growl): 30 yd', confirmBy: 'Plan 3: each spec uses its own taunt spell from client data' },
  },
  {
    key: 'core.taunt_cooldown_ms',
    value: 8000,
    source: { kind: 'assumption', rationale: 'generic 3.3.5a tank taunt cooldown: 8 s', confirmBy: 'Plan 3: each spec uses its own taunt spell from client data' },
  },
  {
    key: 'core.taunt_duration_ms',
    value: 3000,
    source: { kind: 'assumption', rationale: 'generic 3.3.5a taunt effect duration: 3 s', confirmBy: 'Plan 3: each spec uses its own taunt spell from client data' },
  },
```

`packages/engine/src/run.ts`:
- In `checkContent`, use `ENGINE_ACTION_NAMES.has(r.do.do)` instead of `BUILTIN_ACTIONS.has(r.do.do)`.
- Build the handler map with the taunt action, reading the three keys only when a rule uses `taunt` (so runs without taunts do not report these assumptions); registry actions may override engine actions:

  ```ts
  const handlers = new Map<string, ActionHandler>(BUILTIN_ACTIONS);
  if (plan.rules.some((r) => r.do.do === 'taunt')) {
    handlers.set(
      'taunt',
      createTauntAction({
        rangeYd: data.num('core.taunt_range_yd'),
        cooldownMs: data.num('core.taunt_cooldown_ms'),
        durationMs: data.num('core.taunt_duration_ms'),
      }),
    );
  }
  for (const [name, handler] of registry.actions) handlers.set(name, handler);
  ```
  and pass `handlers` to the `RuleEngine`.
- Update the `invalid` test in `run.test.ts` that expected `no handler for action taunt`: `taunt` is now an engine action, so use a made-up action name instead. Because `ActionSchema` only allows known actions, construct the case by registering nothing for `use_cooldown`: change the rule in that test to `do: { do: use_cooldown, spell: test_bolt }` and expect `no handler for action use_cooldown`.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat(engine): taunt effect and taunt rule action with sourced generic values

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Permanent auras, stack scope, aura and spell scripts, damage modifiers

What Festergut's script needs from auras (contract list item 4/5): permanent auras (ambient blight, Inhaled Blight), auras that stack per unit regardless of caster, hooks after apply/stack/remove (Blighted Spores → Inoculated; Gastric Bloat at 10 stacks), hooks after a spell hits a target (Pungent Blight removes Inoculated), and damage modifiers driven by auras (Inoculated reduces damage taken; Inhaled Blight raises damage done).

**Files:**
- Create: `packages/engine/src/modifiers.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/units.ts`, `packages/engine/src/auras.ts`, `packages/engine/src/effects.ts`, `packages/engine/src/casting.ts`, `packages/engine/src/view.ts`, `packages/engine/src/sim.ts`
- Test: `packages/engine/test/aura-scripts.test.ts`

- [ ] **Step 1: Write the failing test** `packages/engine/test/aura-scripts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import { installCoreRules, startCast } from '../src/casting';
import { damageMultiplier } from '../src/modifiers';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 1, maxDurationMs: 30000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 10, y: 0 } });
  sim.addUnit({ ...body, id: 'p2', name: 'P2', kind: 'player', role: 'ranged', pos: { x: 12, y: 0 } });
  return sim;
}

describe('aura extensions', () => {
  it('a permanent aura has no expiry and is reported with expiresMs null', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'blight', durationMs: null, maxStacks: 1 });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'blight', 'boss', 'boss', []));
    sim.run();
    expect(sim.unit('boss').auras.size).toBe(1);
    expect(sim.trace.list().find((e) => e.kind === 'aura_applied')?.data.expiresMs).toBeNull();
  });

  it("stack scope 'unit' stacks across casters", () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'inoculated', durationMs: 20000, maxStacks: 3, stackScope: 'unit' });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'inoculated', 'p1', 'p1', []);
      applyAura(sim, 'inoculated', 'p2', 'p1', []);
    });
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'aura_stack').map((e) => e.data.stacks)).toEqual([2]);
  });

  it('runs afterApply, afterStack and afterRemove hooks with the removal reason', () => {
    const sim = newSim();
    const calls: string[] = [];
    sim.catalog.addAura({ id: 'spore', durationMs: 12000, maxStacks: 2 });
    sim.catalog.addAuraScript('spore', {
      afterApply: (c) => calls.push(`apply:${c.unitId}:${c.stacks}`),
      afterStack: (c) => calls.push(`stack:${c.stacks}:${c.refreshedMs}`),
      afterRemove: (c) => calls.push(`remove:${c.reason}`),
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    sim.at(500, EventClass.SpellHit, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    sim.at(1000, EventClass.SpellHit, () => void removeAuras(sim, 'p1', 'spore', 'dispelled', []));
    sim.at(2000, EventClass.SpellHit, () => void applyAura(sim, 'spore', 'boss', 'p2', []));
    sim.run();
    expect(calls).toEqual(['apply:p1:1', 'stack:2:500', 'remove:dispelled', 'apply:p2:1', 'remove:expired']);
  });

  it('a spell script runs after the spell hit a target', () => {
    const sim = newSim();
    const hits: string[] = [];
    sim.catalog.addSpell({ id: 'zap', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 100, usableWhileMoving: true, target: 'unit', effects: [{ type: 'damage', school: 'nature', min: 10, max: 10 }] });
    sim.catalog.addSpellScript('zap', { afterHitTarget: (c) => hits.push(`${c.targetId}:${c.sim.unit(c.targetId).health}`) });
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'boss', 'zap', 'p1', []));
    sim.run();
    expect(hits).toEqual(['p1:99990']);
  });

  it('damage modifiers multiply per stack, by school, from caster and target auras', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'inhaled', durationMs: null, maxStacks: 3, modifiers: [{ kind: 'damage_done_pct', pct: 30, perStack: true }] });
    sim.catalog.addAura({ id: 'inoc', durationMs: 20000, maxStacks: 3, modifiers: [{ kind: 'damage_taken_pct', pct: -25, perStack: true, schools: ['nature'] }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'inhaled', 'boss', 'boss', []);
      applyAura(sim, 'inhaled', 'boss', 'boss', []);
      applyAura(sim, 'inoc', 'p1', 'p1', []);
    });
    sim.at(10, EventClass.SpellHit, () => {
      expect(damageMultiplier(sim, 'boss', 'p1', 'nature')).toBeCloseTo((1 + 0.6) * (1 - 0.25), 10);
      expect(damageMultiplier(sim, 'boss', 'p1', 'physical')).toBeCloseTo(1.6, 10);
      expect(damageMultiplier(sim, 'p2', 'p1', 'nature')).toBeCloseTo(0.75, 10);
    });
    sim.run();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/aura-scripts.test.ts`
Expected: FAIL (`modifiers` module missing; new catalog fields rejected).

- [ ] **Step 3: Catalog types** — in `packages/engine/src/catalog.ts`:

```ts
import type { Simulation } from './sim';

export interface DamageModifier {
  readonly kind: 'damage_done_pct' | 'damage_taken_pct';
  /** Percent change, e.g. -25 for 25 % less. */
  readonly pct: number;
  /** Multiply the percentage by the aura's stacks. */
  readonly perStack: boolean;
  /** Limit to these schools; all schools when absent. */
  readonly schools?: readonly School[];
}

export type AuraRemoveReason = 'expired' | 'removed' | 'dispelled';

export interface AuraHookContext {
  readonly sim: Simulation;
  readonly unitId: string;
  readonly casterId: string;
  readonly auraId: string;
  readonly stacks: number;
  readonly appliedMs: number;
  readonly refreshedMs: number;
  readonly causes: readonly string[];
}

export interface AuraScript {
  afterApply?(ctx: AuraHookContext): void;
  afterStack?(ctx: AuraHookContext): void;
  /** Not called when the aura is removed by death (A-012). */
  afterRemove?(ctx: AuraHookContext & { readonly reason: AuraRemoveReason }): void;
}

export interface SpellHitContext {
  readonly sim: Simulation;
  readonly spellId: string;
  readonly casterId: string;
  readonly targetId: string;
  readonly causes: readonly string[];
}

export interface SpellScript {
  /** Runs after all effects of the spell were applied to the target (A-024). */
  afterHitTarget?(ctx: SpellHitContext): void;
}
```

Change `AuraDef`:

```ts
export interface AuraDef {
  readonly id: string;
  /** Milliseconds, or null for a permanent aura. */
  readonly durationMs: number | null;
  readonly maxStacks: number;
  /** 'caster' (default): one instance per caster; 'unit': one instance per unit, any caster stacks it. */
  readonly stackScope?: 'caster' | 'unit';
  readonly periodic?: { readonly intervalMs: number; readonly effects: readonly Effect[] };
  readonly onExpire?: readonly Effect[];
  readonly modifiers?: readonly DamageModifier[];
}
```

In `Catalog`: allow `durationMs === null` (`if ((def.durationMs !== null && def.durationMs <= 0) || …)`), reject a modifier with a non-finite `pct`, and add

```ts
  private readonly auraScripts = new Map<string, AuraScript>();
  private readonly spellScripts = new Map<string, SpellScript>();

  addAuraScript(auraId: string, script: AuraScript): void {
    this.aura(auraId);
    if (this.auraScripts.has(auraId)) throw new Error(`duplicate aura script ${auraId}`);
    this.auraScripts.set(auraId, script);
  }

  addSpellScript(spellId: string, script: SpellScript): void {
    this.spell(spellId);
    if (this.spellScripts.has(spellId)) throw new Error(`duplicate spell script ${spellId}`);
    this.spellScripts.set(spellId, script);
  }

  auraScript(auraId: string): AuraScript | undefined {
    return this.auraScripts.get(auraId);
  }

  spellScript(spellId: string): SpellScript | undefined {
    return this.spellScripts.get(spellId);
  }
```

- [ ] **Step 4: Units and auras**

`packages/engine/src/units.ts`, `AuraInstance`: `expiresMs: number` becomes the expiry time or `Number.POSITIVE_INFINITY` for permanent auras; `expiry: Scheduled | null`; add `refreshedMs: number`. Change `auraKey` to

```ts
export const auraKey = (auraId: string, casterId: string, scope: 'caster' | 'unit' = 'caster'): string =>
  scope === 'unit' ? `${auraId}|*` : `${auraId}|${casterId}`;
```

`packages/engine/src/auras.ts`, `applyAura`:
- `const key = auraKey(auraId, casterId, def.stackScope ?? 'caster');`
- `const expiresMs = def.durationMs === null ? Number.POSITIVE_INFINITY : sim.now + def.durationMs;`
- schedule the expiry only when finite: `const schedule = (inst: AuraInstance) => Number.isFinite(expiresMs) ? sim.at(expiresMs, EventClass.AuraExpiry, () => expire(sim, targetId, key, inst)) : null;`
- trace data: `expiresMs: Number.isFinite(expiresMs) ? expiresMs : null`
- on stack: `existing.refreshedMs = sim.now;` after emitting `aura_stack`, call
  `sim.catalog.auraScript(auraId)?.afterStack?.(hookContext(sim, existing, targetId, [id]))`
- on new: `refreshedMs: sim.now` in the instance; after emitting `aura_applied` (and scheduling ticks), call `afterApply` likewise.

Add the helper:

```ts
function hookContext(sim: Simulation, inst: AuraInstance, unitId: string, causes: readonly string[]): AuraHookContext {
  return { sim, unitId, casterId: inst.casterId, auraId: inst.auraId, stacks: inst.stacks, appliedMs: inst.appliedMs, refreshedMs: inst.refreshedMs, causes };
}
```

In `expire` (after the `aura_removed` event and the `onExpire` effects) and in `removeAuras` (after each `aura_removed` event) call
`sim.catalog.auraScript(inst.auraId)?.afterRemove?.({ ...hookContext(sim, inst, targetId, [removedId]), reason })`.
`removeAuras` keeps matching by `inst.auraId`, so it works for both stack scopes.

`packages/engine/src/sim.ts` `kill`: `this.cancel(a.expiry)` already accepts null; no hooks on death.

`packages/engine/src/view.ts`: `AuraView.remainingMs` becomes `number | null` (`Number.isFinite(a.expiresMs) ? a.expiresMs - now : null`).

- [ ] **Step 5: Modifiers and effects** — create `packages/engine/src/modifiers.ts`:

```ts
import type { DamageModifier, School } from './catalog';
import type { Simulation } from './sim';
import { compareStrings, type Unit } from './units';

function applies(m: DamageModifier, school: School): boolean {
  return !m.schools || m.schools.includes(school);
}

function factor(sim: Simulation, unit: Unit, kind: DamageModifier['kind'], school: School): number {
  let f = 1;
  for (const key of [...unit.auras.keys()].sort(compareStrings)) {
    const inst = unit.auras.get(key)!;
    for (const m of sim.catalog.aura(inst.auraId).modifiers ?? []) {
      if (m.kind !== kind || !applies(m, school)) continue;
      f *= 1 + (m.pct * (m.perStack ? inst.stacks : 1)) / 100;
    }
  }
  return f;
}

/** Product of the source's damage-done and the target's damage-taken modifiers, never negative. */
export function damageMultiplier(sim: Simulation, sourceId: string, targetId: string, school: School): number {
  const source = sim.units.get(sourceId);
  const target = sim.unit(targetId);
  const done = source ? factor(sim, source, 'damage_done_pct', school) : 1;
  return Math.max(0, done * factor(sim, target, 'damage_taken_pct', school));
}
```

In `packages/engine/src/effects.ts` `case 'damage'`: multiply the rolled amount by `damageMultiplier(sim, ctx.casterId, target.id, e.school)` before `sim.damage`.

In `packages/engine/src/casting.ts` `hit()`: after `applyEffects(...)`, call
`sim.catalog.spellScript(spell.id)?.afterHitTarget?.({ sim, spellId: spell.id, casterId, targetId, causes: [hitId] });`

- [ ] **Step 6: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. Adjust hand-built `AuraInstance` objects in existing tests (`sim.test.ts`) with `refreshedMs: 0`.

- [ ] **Step 7: Commit**

```bash
git add packages
git commit -m "feat(engine): permanent auras, stack scope, aura and spell scripts, damage modifiers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Boss melee

**Files:**
- Create: `packages/engine/src/melee.ts`
- Modify: `packages/engine/src/boss.ts` (`afterEvents`, `ctx.meleeIfReady`), `packages/engine/src/trace.ts` (`melee_avoided`), `packages/format/src/en.ts`, `packages/engine/src/plan/schema.ts`, `packages/engine/src/plan/validate.ts`, `packages/engine/src/run.ts`
- Test: `packages/engine/test/melee.test.ts`

- [ ] **Step 1: Write the failing test** `packages/engine/test/melee.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EventScriptedAI, attachBoss, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { armorReduction, creatureMeleeDamage, meleeIfReady } from '../src/melee';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { ThreatManager } from '../src/threat';

describe('armor reduction (Unit::CalcArmorReducedDamage)', () => {
  it('matches the worked examples', () => {
    expect(armorReduction(26000, 83)).toBeCloseTo(26000 / (26000 + 16635), 6);
    expect(armorReduction(0, 83)).toBe(0);
    expect(armorReduction(1e6, 83)).toBe(0.75);
  });
});

describe('creature melee damage (Creature::CalculateMinMaxDamage)', () => {
  it('Festergut 10n worked example', () => {
    expect(creatureMeleeDamage({ baseDamage: 177.074, attackPower: 805, variance: 1, damageModifier: 75, attackTimeMs: 2000 })).toEqual({ min: 35186, max: 48466 });
  });
});

class Idle extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [];
  protected engage(_ctx: BossContext): void {}
  protected executeEvent(): void {}
}

function newSim(avoidance = { missPct: 0, dodgePct: 0, parryPct: 0 }) {
  const sim = new Simulation({ seed: 3, maxDurationMs: 6500, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, level: 83, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 8, boundingRadius: 0.31, melee: { minDamage: 10000, maxDamage: 10000, attackTimeMs: 2000 } });
  sim.addUnit({ id: 't1', name: 'T1', kind: 'player', role: 'tank', maxHealth: 1e6, armor: 16635, avoidance, pos: { x: 10, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  attachBoss(sim, new Idle(), 'boss', 10);
  threat.add('boss', 't1', 1);
  return sim;
}

describe('boss melee', () => {
  it('swings every attack interval at the victim, mitigated by armor', () => {
    const sim = newSim();
    sim.run();
    const swings = sim.trace.list().filter((e) => e.kind === 'damage' && e.data.ability === 'melee');
    expect(swings.map((e) => e.t)).toEqual([10, 2010, 4010, 6010]);
    expect(swings[0].data.amount).toBe(5000); // armor 16635 at level 83 halves the damage
  });

  it('records avoided swings', () => {
    const sim = newSim({ missPct: 0, dodgePct: 100, parryPct: 0 });
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'melee_avoided').map((e) => e.data.result)).toEqual(['dodge', 'dodge', 'dodge', 'dodge']);
  });

  it('does not swing out of melee range or while casting', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      sim.unit('t1').pos = { x: 30, y: 0 };
    });
    sim.run();
    expect(meleeIfReady(sim, 'boss', sim.unit('t1'))).toBeNull();
    expect(sim.trace.list().some((e) => e.data.ability === 'melee')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/melee.test.ts`
Expected: FAIL, cannot resolve `../src/melee`.

- [ ] **Step 3: Write `packages/engine/src/melee.ts`**

```ts
import { damageMultiplier } from './modifiers';
import { withinMeleeRange } from './movement';
import type { Simulation } from './sim';
import type { Unit } from './units';

/** Unit::CalcArmorReducedDamage (Unit.cpp 2233–2300): reduction = r / (1 + r), r = 0.1 armor / (8.5 L' + 40), capped at 75 %. */
export function armorReduction(armor: number, attackerLevel: number): number {
  const level = attackerLevel > 59 ? attackerLevel + 4.5 * (attackerLevel - 59) : attackerLevel;
  const r = (0.1 * Math.max(0, armor)) / (8.5 * level + 40);
  return Math.min(Math.max(r / (1 + r), 0), 0.75);
}

export interface CreatureMeleeInput {
  readonly baseDamage: number;
  readonly attackPower: number;
  readonly variance: number;
  readonly damageModifier: number;
  readonly attackTimeMs: number;
}

/**
 * Creature::CalculateMinMaxDamage (StatSystem.cpp 1117) with weapon min = base, max = 1.5 × base (Creature.cpp 1554)
 * and the attack-time multiplier (Unit.cpp 13306); truncated to whole numbers before the roll.
 */
export function creatureMeleeDamage(p: CreatureMeleeInput): { min: number; max: number } {
  const ap = (p.attackPower / 14) * p.variance;
  const mult = p.damageModifier * (p.attackTimeMs / 1000);
  return { min: Math.trunc((p.baseDamage + ap) * mult), max: Math.trunc((p.baseDamage * 1.5 + ap) * mult) };
}

/**
 * DoMeleeAttackIfReady: one swing when the swing timer is ready, the attacker is not casting and the victim is in melee range.
 * Outcomes: miss, dodge, parry from the victim's avoidance; no crits, crushing, glancing or block (A-022).
 */
export function meleeIfReady(sim: Simulation, attackerId: string, victim: Unit | null, causes: readonly string[] = []): string | null {
  const a = sim.unit(attackerId);
  if (!a.alive || sim.over || !a.melee || a.cast || !victim || !victim.alive) return null;
  if (sim.now < a.nextSwingMs || !withinMeleeRange(a, victim, sim.now)) return null;
  a.nextSwingMs = sim.now + a.melee.attackTimeMs;
  const rng = sim.rng.stream(`unit:${a.id}.melee`);
  const roll = rng.int(0, 9999);
  const av = victim.avoidance;
  const miss = av.missPct * 100;
  const dodge = miss + av.dodgePct * 100;
  const parry = dodge + av.parryPct * 100;
  const result = roll < miss ? 'miss' : roll < dodge ? 'dodge' : roll < parry ? 'parry' : 'hit';
  if (result !== 'hit') return sim.emit('melee_avoided', { source: a.id, target: victim.id, result }, causes);
  const raw = rng.int(a.melee.minDamage, a.melee.maxDamage);
  const amount = raw * (1 - armorReduction(victim.armor, a.level)) * damageMultiplier(sim, a.id, victim.id, 'physical');
  return sim.damage(victim.id, amount, { sourceId: a.id, ability: 'melee', school: 'physical' }, causes);
}
```

`creatureMeleeDamage` takes whole-number min/max, so `rng.int` in `meleeIfReady` receives integers; content must pass truncated values (Task 13 and Plan 2b do).

- [ ] **Step 4: Hook it into the boss AI**

`packages/engine/src/boss.ts`:
- `BossContext` gains `meleeIfReady(): string | null;` implemented in `makeBossContext` as `() => meleeIfReady(sim, bossId, victimOf(sim, bossId))`.
- `EventScriptedAI.updateAI`:

  ```ts
  updateAI(ctx: BossContext, diffMs: number): void {
    if (!ctx.victim()) return;
    this.events.update(diffMs);
    if (ctx.self.cast) return;
    const id = this.events.execute();
    if (id !== 0) this.executeEvent(id, ctx);
    if (!ctx.self.cast) this.afterEvents(ctx);
  }

  /** DoMeleeAttackIfReady by default; override to change what happens after events. */
  protected afterEvents(ctx: BossContext): void {
    ctx.meleeIfReady();
  }
  ```

`packages/engine/src/trace.ts`: add `'melee_avoided'` to `EVENT_KINDS`. `packages/format/src/en.ts`: `'event.melee_avoided': '{target} avoids {source} ({result})'`.

- [ ] **Step 5: Stand-in combat fields**

`packages/engine/src/plan/schema.ts`, `StandinMemberSchema` gains:

```ts
    armor: z.number().int().min(0).default(0),
    avoidance: z
      .object({ missPct: z.number().finite().min(0).max(100), dodgePct: z.number().finite().min(0).max(100), parryPct: z.number().finite().min(0).max(100) })
      .strict()
      .default({ missPct: 0, dodgePct: 0, parryPct: 0 }),
    threatMultiplier: z.number().finite().min(0).default(1),
```

`packages/engine/src/plan/validate.ts`: for stand-ins, `avoidance` percentages must add up to at most 100 (`avoidance of <id> adds up to more than 100 %`).

`packages/engine/src/run.ts`: pass `armor`, `avoidance` and `threatMultiplier` to `sim.addUnit` for stand-ins.

Add to `packages/engine/test/plan.test.ts`:

```ts
describe('stand-in combat fields', () => {
  it('default to no armor, no avoidance and threat multiplier 1', () => {
    const { plan } = parsed();
    expect(plan.roster.find((m) => m.id === 't1')).toMatchObject({ armor: 0, avoidance: { missPct: 0, dodgePct: 0, parryPct: 0 }, threatMultiplier: 1 });
  });

  it('reject avoidance above 100 % in total', () => {
    const r = parsePlan('plan.yaml', PLAN.replace('ratePerSecond: 500,', 'ratePerSecond: 500, avoidance: { missPct: 50, dodgePct: 40, parryPct: 20 },'));
    if (!r.ok) throw new Error('must parse');
    const { scenario } = parsed();
    const prepared = prepareRun({ plan: r.value, planFile: 'plan.yaml', scenario, scenarioFile: 's.yaml' });
    expect(prepared.ok ? [] : prepared.problems.map((p) => p.message)).toContain('avoidance of t1 adds up to more than 100 %');
  });
});
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages
git commit -m "feat(engine): boss melee swings with armor, avoidance and damage modifiers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Triggered casts and target selection

**Files:**
- Modify: `packages/engine/src/casting.ts`, `packages/engine/src/boss.ts`
- Test: `packages/engine/test/boss-targeting.test.ts`

- [ ] **Step 1: Write the failing test** `packages/engine/test/boss-targeting.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeBossContext } from '../src/boss';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { ThreatManager } from '../src/threat';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 9, maxDurationMs: 5000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, combatReach: 8, pos: { x: 0, y: 0 } });
  for (const [id, x] of [['t1', 10], ['m1', 11], ['r1', 30], ['r2', 35], ['h1', 25]] as const) {
    sim.addUnit({ ...body, id, name: id, kind: 'player', role: id.startsWith('t') ? 'tank' : 'ranged', pos: { x, y: 0 } });
  }
  sim.catalog.addSpell({ id: 'channel', castTimeMs: 3000, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: false, target: 'self', effects: [] });
  sim.catalog.addSpell({ id: 'blight', castTimeMs: 2000, gcdMs: 1500, cooldownMs: 10000, rangeYd: 5, usableWhileMoving: false, target: 'unit', effects: [{ type: 'damage', school: 'nature', min: 1, max: 1 }] });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  threat.add('boss', 't1', 100);
  for (const id of ['m1', 'r1', 'r2', 'h1']) threat.add('boss', id, 0);
  return sim;
}

describe('triggered casts', () => {
  it('ignore cast time, GCD, cooldown, casting state and range', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => {
      startCast(sim, 'boss', 'channel', 'boss', []);
      const r = startCast(sim, 'boss', 'blight', 'r2', [], { triggered: true });
      expect(r.ok).toBe(true);
      expect(sim.unit('boss').cast?.spellId).toBe('channel');
      expect(sim.unit('boss').cooldowns.get('blight')).toBeUndefined();
    });
    sim.run();
    const hit = sim.trace.list().find((e) => e.kind === 'spell_hit' && e.data.spell === 'blight');
    expect(hit?.t).toBe(0);
  });
});

describe('boss target selection', () => {
  it('picks from the threat list with distance limits, from its own stream', () => {
    const sim = newSim();
    const ctx = makeBossContext(sim, 'boss');
    expect(ctx.threatList().map((u) => u.id)).toEqual(['h1', 'm1', 'r1', 'r2', 't1']);
    for (let i = 0; i < 20; i++) {
      const far = ctx.selectTarget('vile_gas', { minDistanceYd: 5 });
      expect(['h1', 'r1', 'r2']).toContain(far?.id);
      const notTank = ctx.selectTarget('goo', { excludeVictim: true });
      expect(notTank?.id).not.toBe('t1');
    }
    expect(ctx.selectTarget('none', { minDistanceYd: 100 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/boss-targeting.test.ts`
Expected: FAIL (`startCast` ignores options; `selectTarget` missing).

- [ ] **Step 3: Triggered casts** in `packages/engine/src/casting.ts`:

```ts
export interface CastOptions {
  /** AzerothCore CastSpell(..., triggered = true): no cast time, GCD, cooldown, casting or range checks (A-020). */
  readonly triggered?: boolean;
}
```

`startCast(sim, casterId, spellId, targetId, causes, options: CastOptions = {})`. At the top, when `options.triggered`:

```ts
  if (options.triggered) {
    if (!sim.catalog.hasSpell(spellId)) return failed('unknown_spell');
    const spell = sim.catalog.spell(spellId);
    const caster = sim.unit(casterId);
    const tId = resolveTarget(spell, casterId, targetId);
    const target = sim.units.get(tId);
    if (sim.over) return { ok: false, reason: 'fight_over', event: '' };
    if (!caster.alive) return failed('dead');
    if (!target || !target.alive) return failed('target_dead');
    const event = sim.emit('cast_start', { caster: casterId, spell: spellId, target: tId, castTimeMs: 0, endMs: sim.now, triggered: true }, causes);
    complete(sim, caster, spell, tId, event, true);
    return { ok: true, event };
  }
```

where `failed(reason)` emits `cast_failed` like the existing path (extract the existing failure emission into this local helper). `complete` gets a `triggered = false` parameter: when true it skips the range check and does not start a cooldown.

- [ ] **Step 4: Boss context** in `packages/engine/src/boss.ts`, `BossContext` gains:

```ts
  cast(spellId: string, targetId: string, causes: readonly string[], options?: CastOptions): CastResult;
  /** Living units on this boss's threat list, sorted by id. */
  threatList(): Unit[];
  /**
   * SelectTarget(Random, …) on the threat list from stream `boss:<id>.<mechanic>`. Distances are edge to edge (A-021):
   * minDistanceYd = must be farther than, maxDistanceYd = must be within.
   */
  selectTarget(mechanic: string, options?: { minDistanceYd?: number; maxDistanceYd?: number; excludeVictim?: boolean }): Unit | null;
```

Implementation in `makeBossContext`:

```ts
    cast: (spellId, targetId, causes, options) => startCast(sim, bossId, spellId, targetId, causes, options),
    threatList: () => threatFor(sim)?.listed(bossId) ?? [],
    selectTarget: (mechanic, options = {}) => {
      const victim = victimOf(sim, bossId);
      const candidates = (threatFor(sim)?.listed(bossId) ?? []).filter((u) => {
        const d = edgeDistance(self, u, sim.now);
        if (options.minDistanceYd !== undefined && !(d > options.minDistanceYd)) return false;
        if (options.maxDistanceYd !== undefined && d > options.maxDistanceYd) return false;
        if (options.excludeVictim && victim && u.id === victim.id) return false;
        return true;
      });
      return sim.rng.stream(`boss:${bossId}.${mechanic}`).pick(candidates, 1)[0] ?? null;
    },
```

(imports: `edgeDistance` from `./movement`, `CastOptions` from `./casting`, `threatFor` from `./threat`.)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages
git commit -m "feat(engine): triggered casts and threat-list target selection for boss scripts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Kill set, primary boss, script data, clearing timers

**Files:**
- Modify: `packages/engine/src/sim.ts`, `packages/engine/src/run.ts`, `packages/engine/src/rules.ts`, `packages/engine/src/boss.ts`
- Modify tests: every `new RuleEngine(...)` call (`rules.test.ts`, `taunt.test.ts`) gains `primaryBoss`
- Test: `packages/engine/test/encounter.test.ts`

- [ ] **Step 1: Write the failing test** `packages/engine/test/encounter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeBossContext } from '../src/boss';
import { PlanSchema } from '../src/plan/schema';
import { EventClass } from '../src/queue';
import { BUILTIN_ACTIONS, RuleEngine } from '../src/rules';
import { Simulation } from '../src/sim';

const body = { maxHealth: 1000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 1, maxDurationMs: 5000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'festergut', name: 'Festergut', kind: 'creature', role: 'boss', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'putricide', name: 'Putricide', kind: 'creature', role: 'boss', pos: { x: 0, y: 50 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 10, y: 0 } });
  return sim;
}
const hit = { sourceId: 'p1', ability: 'x', school: 'physical' as const };

describe('encounter rules', () => {
  it('the fight is won when every unit in the kill set is dead', () => {
    const sim = newSim();
    sim.mustKill.add('festergut');
    sim.at(100, EventClass.SpellHit, () => void sim.damage('festergut', 1e6, hit, []));
    expect(sim.run()).toMatchObject({ kind: 'kill', atMs: 100 });
  });

  it("the plan reference 'boss' means the primary boss", () => {
    const sim = newSim();
    const plan = PlanSchema.parse({
      id: 'p',
      boss: 'festergut',
      roster: [{ id: 'p1', name: 'P1', kind: 'standin', role: 'ranged', maxHealth: 1000, ratePerSecond: 0, reaction: { minMs: 0, maxMs: 0 } }],
      spots: { home: { x: 10, y: 0 }, away: { x: 20, y: 0 } },
      phases: [{ phase: 'default', assignments: { p1: 'home' } }],
      rules: [{ id: 'dodge', who: ['p1'], when: { on: 'cast_start', spell: 'nova', caster: 'boss' }, do: { do: 'move_to', spot: 'away' } }],
    });
    sim.catalog.addSpell({ id: 'nova', castTimeMs: 1000, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: false, target: 'self', effects: [] });
    new RuleEngine(sim, plan, BUILTIN_ACTIONS, { currentTank: () => null, primaryBoss: () => sim.unit('festergut') }).install();
    sim.at(100, EventClass.Decision, () => {
      sim.emit('cast_start', { caster: 'putricide', spell: 'nova', target: 'putricide' });
      sim.emit('cast_start', { caster: 'festergut', spell: 'nova', target: 'festergut' });
    });
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'rule_fired')).toHaveLength(1);
  });

  it('scripts keep numeric state and can clear a published timer', () => {
    const sim = newSim();
    const ctx = makeBossContext(sim, 'festergut');
    expect(ctx.getData('inoculated_max')).toBeUndefined();
    ctx.setData('inoculated_max', 2);
    expect(ctx.getData('inoculated_max')).toBe(2);
    ctx.publishTimer('vile_gas', 30000, 40000, []);
    ctx.clearTimer('vile_gas', []);
    expect(sim.timerWindows.has('festergut|vile_gas')).toBe(false);
    expect(sim.trace.list().at(-1)?.data).toMatchObject({ ability: 'vile_gas', cleared: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/encounter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/engine/src/sim.ts`: add `readonly mustKill = new Set<string>();` and in `checkOutcome` use it:

```ts
    const required = this.mustKill.size > 0 ? this.sortedUnits((u) => this.mustKill.has(u.id)) : this.bosses();
    if (required.length > 0 && required.every((b) => !b.alive)) this.finish('kill', [cause]);
    else if (players.length > 0 && players.every((p) => !p.alive)) this.finish('wipe', [cause]);
```

`packages/engine/src/run.ts`: `BossSetup` gains `readonly mustKill?: readonly string[];` and after `boss.setup` succeeds:
`for (const id of setup.mustKill ?? [setup.bossUnitId]) sim.mustKill.add(id);`
Pass `primaryBoss: () => sim.unit(setup.bossUnitId)` to the `RuleEngine` hooks.

`packages/engine/src/rules.ts`: `RuleHooks` gains `primaryBoss(): Unit | null;`. In `refMatches`, `ref === 'boss'` becomes `return this.hooks.primaryBoss()?.id === unitId;`; in the action context `resolve`, `'boss'` returns `this.hooks.primaryBoss()`.

`packages/engine/src/boss.ts`, `BossContext` gains

```ts
  setData(key: string, value: number): void;
  getData(key: string): number | undefined;
  /** Removes a published timer window (after a reschedule or delay) and records it. */
  clearTimer(ability: string, causes: readonly string[]): string | null;
```

implemented in `makeBossContext` with a `const data = new Map<string, number>();` closure and

```ts
    clearTimer: (ability, causes) => {
      if (!sim.timerWindows.delete(`${bossId}|${ability}`)) return null;
      return sim.emit('timer_window', { boss: bossId, ability, earliestMs: null, latestMs: null, cleared: true }, causes);
    },
```

Update the `RuleEngine` constructions in `rules.test.ts` and `taunt.test.ts` to pass `primaryBoss: () => sim.unit('boss')`.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat(engine): kill set, primary boss reference, script data, clearing timers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Rules checked against the content's catalog

A typo in a rule's aura or spell id would make the rule silently never fire. After the boss and every modelled spec have registered their spells and auras, the runner checks the plan's references.

**Files:**
- Modify: `packages/engine/src/run.ts`
- Test: `packages/engine/test/run.test.ts` (new case)

- [ ] **Step 1: Write the failing test** — add to `packages/engine/test/run.test.ts`:

```ts
  it('reports rule references to auras or spells the content does not define', () => {
    const typo = PLAN_YAML.replace('aura: mark, target: self', 'aura: mrak, target: self');
    const r = runScenario(prepared([], typo), registry);
    expect(r.outcome).toBe('invalid');
    if (r.outcome === 'invalid') {
      expect(r.problems).toEqual([{ file: 'dummy-plan.yaml', path: 'rules.0.when.aura', message: 'unknown aura mrak' }]);
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/run.test.ts`
Expected: FAIL (the run proceeds).

- [ ] **Step 3: Implement** in `packages/engine/src/run.ts`:

```ts
function checkCatalogReferences(p: PreparedRun, sim: Simulation): LoadProblem[] {
  const problems: LoadProblem[] = [];
  p.plan.rules.forEach((r, i) => {
    const w = r.when;
    if ((w.on === 'aura_applied' || w.on === 'aura_stacks') && !sim.catalog.hasAura(w.aura)) {
      problems.push({ file: p.planFile, path: `rules.${i}.when.aura`, message: `unknown aura ${w.aura}` });
    }
    if (w.on === 'cast_start' && !sim.catalog.hasSpell(w.spell)) {
      problems.push({ file: p.planFile, path: `rules.${i}.when.spell`, message: `unknown spell ${w.spell}` });
    }
    if (r.do.do === 'use_cooldown' && !sim.catalog.hasSpell(r.do.spell)) {
      problems.push({ file: p.planFile, path: `rules.${i}.do.spell`, message: `unknown spell ${r.do.spell}` });
    }
  });
  return problems;
}
```

Call it after the roster loop (when all policy factories have registered their spells) and return `{ outcome: 'invalid', problems }` if it found any.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): reject rules that reference unknown auras or spells

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Content package with the training dummy

A small but real encounter for demos and CLI tests: a dummy that melees its victim and marks two players in range every 12 s; marked players run out. Festergut joins this package in Plan 2b.

**Files:**
- Create: `packages/content/package.json`, `packages/content/src/index.ts`, `packages/content/src/training-dummy/data.ts`, `packages/content/src/training-dummy/boss.ts`, `packages/content/src/training-dummy/caster.ts`
- Create: `scenarios/training-dummy/plan.yaml`, `scenarios/training-dummy/clean.yaml`
- Test: `packages/content/test/training-dummy.test.ts`

- [ ] **Step 1: Package**

`packages/content/package.json`:
```json
{
  "name": "@raid/content",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-only",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@raid/data": "workspace:*", "@raid/engine": "workspace:*" }
}
```

Run: `pnpm install`

- [ ] **Step 2: Scenario files**

`scenarios/training-dummy/plan.yaml`:
```yaml
id: training-dummy-basic
boss: training_dummy
roster:
  - { id: t1, name: Tanky, kind: standin, role: tank, maxHealth: 40000, ratePerSecond: 600, armor: 25000, avoidance: { missPct: 5, dodgePct: 15, parryPct: 15 }, threatMultiplier: 3, reaction: { minMs: 300, maxMs: 300 } }
  - { id: h1, name: Healy, kind: standin, role: healer, maxHealth: 20000, ratePerSecond: 2500, reaction: { minMs: 300, maxMs: 300 } }
  - { id: p1, name: Alice, kind: modelled, spec: training_caster, profile: default, reaction: { minMs: 300, maxMs: 500 } }
  - { id: p2, name: Bob, kind: modelled, spec: training_caster, profile: default, reaction: { minMs: 300, maxMs: 500 } }
  - { id: p3, name: Cara, kind: standin, role: ranged, maxHealth: 20000, ratePerSecond: 1500, reaction: { minMs: 300, maxMs: 500 } }
spots:
  tank: { x: 6, y: 0 }
  heal: { x: -20, y: 0 }
  ranged: { x: 20, y: 0 }
  out: { x: 40, y: 0 }
phases:
  - phase: default
    assignments: { t1: tank, h1: heal, p1: ranged, p2: ranged, p3: ranged }
rules:
  - id: run-when-marked
    who: [p1, p2, p3, h1]
    when: { on: aura_applied, aura: mark, target: self }
    do: { do: move_to, spot: out }
    priority: 60
```

`scenarios/training-dummy/clean.yaml`:
```yaml
id: training-dummy-clean
plan: plan.yaml
difficulty: 25n
seed: 42
maxDurationMs: 120000
observation:
  text: scenario.training_dummy_clean.observation
  checks:
    - { check: outcome_is, outcome: kill }
    - { check: event_occurs, kind: aura_applied, where: { aura: mark } }
    - { check: event_absent, kind: death, where: { unit: t1 } }
```

- [ ] **Step 3: Write the failing test** `packages/content/test/training-dummy.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { parsePlan, parseScenario, prepareRun, runScenario } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/index';

function run() {
  const plan = parsePlan('plan.yaml', readFileSync('scenarios/training-dummy/plan.yaml', 'utf8'));
  const scenario = parseScenario('clean.yaml', readFileSync('scenarios/training-dummy/clean.yaml', 'utf8'));
  if (!plan.ok || !scenario.ok) throw new Error('scenario files must parse');
  const prepared = prepareRun({ plan: plan.value, planFile: 'plan.yaml', scenario: scenario.value, scenarioFile: 'clean.yaml' });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.problems));
  return runScenario(prepared.value, CONTENT);
}

describe('training dummy', () => {
  it('is killed with every observation passing', () => {
    const r = run();
    if (r.outcome === 'invalid') throw new Error(JSON.stringify(r.problems));
    expect(r.outcome).toBe('kill');
    expect(r.summary.observations.every((o) => o.pass)).toBe(true);
    const kinds = new Set(r.trace.events.map((e) => e.kind));
    for (const k of ['threat_target', 'aura_applied', 'move_start', 'heal'] as const) expect(kinds.has(k), k).toBe(true);
    expect(r.trace.events.some((e) => e.kind === 'damage' && e.data.ability === 'melee')).toBe(true);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm test packages/content`
Expected: FAIL, cannot resolve `../src/index`.

- [ ] **Step 5: Write the content**

`packages/content/src/training-dummy/data.ts`:
```ts
const configured = { kind: 'configured', file: 'packages/content/src/training-dummy/data.ts' } as const;

/** Training dummy values: invented for demos, not taken from the game. */
export const TRAINING_DUMMY_DATA: readonly unknown[] = [
  ['training_dummy.health', 150000],
  ['training_dummy.combat_reach_yd', 5],
  ['training_dummy.melee_min', 3000],
  ['training_dummy.melee_max', 4000],
  ['training_dummy.attack_time_ms', 2000],
  ['training_dummy.mark_interval_ms', 12000],
  ['training_dummy.mark_range_yd', 30],
  ['training_dummy.mark_duration_ms', 3000],
  ['training_caster.health', 20000],
  ['training_caster.bolt_min', 1000],
  ['training_caster.bolt_max', 1200],
  ['training_caster.bolt_cast_ms', 1500],
  ['training_caster.bolt_range_yd', 40],
].map(([key, value]) => ({ key, value, source: configured }));
```

`packages/content/src/training-dummy/boss.ts`:
```ts
import { EventScriptedAI, applyAura, edgeDistance, threatFor, type BossContext, type BossModule, type MechanicStatus } from '@raid/engine';
import { TRAINING_DUMMY_DATA } from './data';

const EVENT_MARK = 1;
const ID = 'training_dummy';

class TrainingDummyAI extends EventScriptedAI {
  readonly bossId = ID;
  readonly mechanics: readonly MechanicStatus[] = [
    { key: 'training_dummy.mark', status: 'implemented', omissions: [], validation: 'unvalidated' },
    { key: 'training_dummy.melee', status: 'implemented', omissions: [], validation: 'unvalidated' },
  ];

  constructor(
    private readonly intervalMs: number,
    private readonly rangeYd: number,
  ) {
    super();
  }

  protected engage(_ctx: BossContext): void {
    this.events.schedule(EVENT_MARK, this.intervalMs);
  }

  protected executeEvent(id: number, ctx: BossContext): void {
    if (id !== EVENT_MARK) return;
    const eligible = ctx.threatList().filter((p) => edgeDistance(ctx.self, p, ctx.sim.now) <= this.rangeYd);
    const picked = ctx.pick('mark', eligible, 2);
    const ev = ctx.ai('mark', { eligible: eligible.map((u) => u.id), picked: picked.map((u) => u.id) });
    for (const u of picked) applyAura(ctx.sim, 'mark', ctx.self.id, u.id, [ev]);
    ctx.publishTimer('mark', this.intervalMs, this.intervalMs, [ev]);
    this.events.schedule(EVENT_MARK, this.intervalMs);
  }
}

export const trainingDummy: BossModule = {
  id: ID,
  data: TRAINING_DUMMY_DATA,
  overrides: [],
  setup({ sim, data }) {
    sim.addUnit({
      id: ID,
      name: 'Training Dummy',
      kind: 'creature',
      role: 'boss',
      level: 83,
      maxHealth: data.num('training_dummy.health'),
      pos: { x: 0, y: 0 },
      speedYdPerSec: 0,
      combatReach: data.num('training_dummy.combat_reach_yd'),
      boundingRadius: 1,
      melee: { minDamage: data.num('training_dummy.melee_min'), maxDamage: data.num('training_dummy.melee_max'), attackTimeMs: data.num('training_dummy.attack_time_ms') },
    });
    sim.catalog.addAura({ id: 'mark', durationMs: data.num('training_dummy.mark_duration_ms'), maxStacks: 1 });
    return {
      script: new TrainingDummyAI(data.num('training_dummy.mark_interval_ms'), data.num('training_dummy.mark_range_yd')),
      bossUnitId: ID,
      pull(s) {
        const threat = threatFor(s)!;
        const tank = s.players().find((p) => p.role === 'tank');
        if (tank) threat.add(ID, tank.id, 1);
        for (const p of s.players()) threat.add(ID, p.id, 0);
      },
    };
  },
};
```

`packages/content/src/training-dummy/caster.ts`:
```ts
import type { PolicyFactory } from '@raid/engine';

/** An invented spec for demos: casts a bolt at the boss whenever it can. */
export const trainingCaster: PolicyFactory = {
  spec: 'training_caster',
  role: 'ranged',
  create({ sim, data }) {
    if (!sim.catalog.hasSpell('training_bolt')) {
      sim.catalog.addSpell({
        id: 'training_bolt',
        castTimeMs: data.num('training_caster.bolt_cast_ms'),
        gcdMs: 1500,
        cooldownMs: 0,
        rangeYd: data.num('training_caster.bolt_range_yd'),
        usableWhileMoving: false,
        target: 'unit',
        effects: [{ type: 'damage', school: 'fire', min: data.num('training_caster.bolt_min'), max: data.num('training_caster.bolt_max') }],
      });
    }
    return {
      unit: {
        maxHealth: data.num('training_caster.health'),
        speedYdPerSec: data.num('core.player_run_speed_yd_s'),
        combatReach: data.num('core.player_combat_reach_yd'),
        boundingRadius: data.num('core.player_bounding_radius_yd'),
      },
      policy: {
        wakeOn: { anyHealthChange: false, anyAuraChange: false },
        decide(view) {
          const boss = view.units.find((u) => u.role === 'boss' && u.alive);
          if (!boss || !view.canCast('training_bolt', boss.id).ok) return { type: 'none' };
          return { type: 'cast', spell: 'training_bolt', target: boss.id };
        },
      },
    };
  },
};
```

(`gcdMs: 1500` is the standard global cooldown; if the reviewer asks, move it into the data list as `training_caster.gcd_ms`.)

`packages/content/src/index.ts`:
```ts
import type { ContentRegistry } from '@raid/engine';
import { trainingDummy } from './training-dummy/boss';
import { trainingCaster } from './training-dummy/caster';

export const CONTENT: ContentRegistry = {
  bosses: new Map([[trainingDummy.id, trainingDummy]]),
  policies: new Map([[trainingCaster.spec, trainingCaster]]),
  actions: new Map(),
  checks: new Map(),
};

/** English names of content abilities and scenario texts, for the formatter. */
export const CONTENT_TEXT_EN: Readonly<Record<string, string>> = {
  'ability.mark': 'Mark of the Dummy',
  'ability.melee': 'Melee',
  'ability.training_bolt': 'Training Bolt',
  'ability.standin_damage': 'attack',
  'ability.standin_heal': 'heal',
  'scenario.training_dummy_clean.observation': 'The dummy marks two players in range every 12 seconds; marked players run out of range.',
};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test packages/content && pnpm typecheck`
Expected: PASS. If the dummy is not killed within 120 s, report the actual duration and damage totals instead of changing the observation.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml packages/content scenarios
git commit -m "feat(content): training dummy encounter and content registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: `raid-sim run`

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/src/cli.ts`, `packages/cli/src/main.ts`
- Modify: root `package.json` (script `sim`)
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Package and script**

`packages/cli/package.json`:
```json
{
  "name": "@raid/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-only",
  "exports": { ".": "./src/cli.ts" },
  "dependencies": { "@raid/content": "workspace:*", "@raid/engine": "workspace:*", "@raid/format": "workspace:*" }
}
```

Root `package.json` script: `"sim": "tsx packages/cli/src/main.ts"`. Run `pnpm install`.

- [ ] **Step 2: Write the failing test** `packages/cli/test/cli.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runCli, type Io } from '../src/cli';

function memoryIo() {
  const written = new Map<string, string>();
  const lines: string[] = [];
  const io: Io = {
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, c) => void written.set(p.replace(/\\/g, '/'), c),
    mkdir: () => {},
    out: (l) => void lines.push(l),
  };
  return { io, written, lines };
}

describe('raid-sim run', () => {
  it('runs a scenario and writes trace, summary and log', () => {
    const { io, written, lines } = memoryIo();
    const code = runCli(['run', 'scenarios/training-dummy/clean.yaml', '--out', 'out/test'], io);
    expect(code).toBe(0);
    expect([...written.keys()].sort()).toEqual(['out/test/log.txt', 'out/test/summary.json', 'out/test/trace.json']);
    expect(lines[0]).toMatch(/^training-dummy-clean: kill at \d\d:\d\d\.\d{3}$/);
    expect(written.get('out/test/log.txt')).toContain('Training Dummy engaged');
    expect(JSON.parse(written.get('out/test/trace.json')!).schemaVersion).toBe(1);
  });

  it('overrides the seed', () => {
    const { io, written } = memoryIo();
    runCli(['run', 'scenarios/training-dummy/clean.yaml', '--out', 'o', '--seed', '7'], io);
    expect(JSON.parse(written.get('o/trace.json')!).meta.seed).toBe(7);
  });

  it('reports invalid input with exit code 2 and usage errors with 64', () => {
    const missing = memoryIo();
    expect(runCli(['run', 'scenarios/does-not-exist.yaml'], { ...missing.io, readFile: () => { throw new Error('ENOENT'); } })).toBe(2);
    expect(runCli(['walk'], memoryIo().io)).toBe(64);
    expect(runCli(['run', 'x.yaml', '--seed', '-1'], memoryIo().io)).toBe(64);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test packages/cli`
Expected: FAIL, cannot resolve `../src/cli`.

- [ ] **Step 4: Write `packages/cli/src/cli.ts`**

```ts
import { dirname, join, resolve } from 'node:path';
import { CONTENT, CONTENT_TEXT_EN } from '@raid/content';
import { canonicalStringify, parsePlan, parseScenario, prepareRun, runScenario, type ContentRegistry, type RunResult } from '@raid/engine';
import { EN, clock, formatLog } from '@raid/format';

export interface Io {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  mkdir(path: string): void;
  out(line: string): void;
}

export interface RunOptions {
  readonly seed?: number;
}

const USAGE = 'usage: raid-sim run <scenario.yaml> [--out <dir>] [--seed <n>]';

function readOrProblem(io: Pick<Io, 'readFile'>, path: string, from: string): string | RunResult {
  try {
    return io.readFile(path);
  } catch {
    return { outcome: 'invalid', problems: [{ file: from, path: '(file)', message: `cannot read ${path}` }] };
  }
}

/** Loads a scenario and its plan from disk and runs it. */
export function runScenarioFile(scenarioPath: string, io: Pick<Io, 'readFile'>, registry: ContentRegistry = CONTENT, options: RunOptions = {}): RunResult {
  const scenarioText = readOrProblem(io, scenarioPath, scenarioPath);
  if (typeof scenarioText !== 'string') return scenarioText;
  const scenario = parseScenario(scenarioPath, scenarioText);
  if (!scenario.ok) return { outcome: 'invalid', problems: scenario.problems };
  const planPath = resolve(dirname(scenarioPath), scenario.value.plan);
  const planText = readOrProblem(io, planPath, scenarioPath);
  if (typeof planText !== 'string') return planText;
  const plan = parsePlan(planPath, planText);
  if (!plan.ok) return { outcome: 'invalid', problems: plan.problems };
  const s = options.seed === undefined ? scenario.value : { ...scenario.value, seed: options.seed };
  const prepared = prepareRun({ scenario: s, scenarioFile: scenarioPath, plan: plan.value, planFile: planPath });
  if (!prepared.ok) return { outcome: 'invalid', problems: prepared.problems };
  return runScenario(prepared.value, registry);
}

export function runCli(argv: readonly string[], io: Io, registry: ContentRegistry = CONTENT, text: Readonly<Record<string, string>> = CONTENT_TEXT_EN): number {
  const [command, scenarioPath, ...rest] = argv;
  if (command !== 'run' || !scenarioPath) {
    io.out(USAGE);
    return 64;
  }
  let outDir: string | undefined;
  let seed: number | undefined;
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (value === undefined || (flag !== '--out' && flag !== '--seed')) {
      io.out(USAGE);
      return 64;
    }
    if (flag === '--out') outDir = value;
    else {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) {
        io.out(`invalid seed ${value}`);
        return 64;
      }
      seed = n;
    }
  }
  const result = runScenarioFile(scenarioPath, io, registry, seed === undefined ? {} : { seed });
  if (result.outcome === 'invalid') {
    io.out('invalid input:');
    for (const p of result.problems) io.out(`  ${p.file}: ${p.path}: ${p.message}`);
    return 2;
  }
  const dir = outDir ?? join('out', result.trace.meta.scenario);
  io.mkdir(dir);
  io.writeFile(join(dir, 'trace.json'), `${canonicalStringify(result.trace)}\n`);
  io.writeFile(join(dir, 'summary.json'), `${canonicalStringify(result.summary)}\n`);
  io.writeFile(join(dir, 'log.txt'), `${formatLog(result.trace, EN, text).join('\n')}\n`);
  const s = result.summary;
  io.out(`${result.trace.meta.scenario}: ${s.outcome} at ${clock(s.durationMs)}`);
  io.out(`deaths: ${s.deaths.length}`);
  for (const d of s.deaths) io.out(`  ${d.unit} at ${clock(d.atMs)}${d.killingBlow ? ` (${d.killingBlow.ability} from ${d.killingBlow.source})` : ''}`);
  for (const o of s.observations) io.out(`${o.pass ? 'PASS' : 'FAIL'} ${o.check}: ${o.detail}`);
  const l = s.limitations;
  io.out(`limitations: ${l.standIns.length} stand-ins, ${l.assumptions.length} assumptions, ${l.partialMechanics.length} partial mechanics`);
  io.out(`wrote ${dir}`);
  return s.observations.every((o) => o.pass) ? 0 : 1;
}
```

`packages/cli/src/main.ts`:
```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runCli } from './cli';

process.exit(
  runCli(process.argv.slice(2), {
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, c) => writeFileSync(p, c),
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    out: (l) => console.log(l),
  }),
);
```

- [ ] **Step 5: Run the tests, then the real command**

Run: `pnpm test packages/cli && pnpm typecheck && pnpm sim run scenarios/training-dummy/clean.yaml`
Expected: tests PASS; the command prints `training-dummy-clean: kill at …`, three `PASS` lines and `wrote out/training-dummy-clean` (the `out/` folder is git-ignored).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml packages/cli
git commit -m "feat(cli): raid-sim run writes trace, summary and English log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Golden runs

**Files:**
- Create: `packages/cli/src/golden.ts`, `packages/cli/src/golden-cli.ts`, `scenarios/golden.json`
- Modify: root `package.json` (scripts `golden`, `golden:update`)
- Test: `packages/cli/test/golden.test.ts`

- [ ] **Step 1: Write `packages/cli/src/golden.ts`**

```ts
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
```

`packages/cli/src/golden-cli.ts`:
```ts
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
```

Root scripts: `"golden": "tsx packages/cli/src/golden-cli.ts"`, `"golden:update": "tsx packages/cli/src/golden-cli.ts --update"`.

- [ ] **Step 2: Create the golden file**

`scenarios/golden.json`:
```json
{
  "scenarios/training-dummy/clean.yaml": "pending"
}
```

Run: `pnpm golden:update && cat scenarios/golden.json`
Expected: the value is now a 64-character hex string.

- [ ] **Step 3: Write the test** `packages/cli/test/golden.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkGolden, readGolden } from '../src/golden';

const io = { readFile: (p: string) => readFileSync(p, 'utf8') };

describe('golden runs', () => {
  it('lists at least one scenario', () => {
    expect(Object.keys(readGolden(io)).length).toBeGreaterThan(0);
  });

  it('every pinned scenario still produces the same canonical trace (update deliberately with pnpm golden:update)', () => {
    expect(checkGolden(io)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run it**

Run: `pnpm test packages/cli && pnpm golden`
Expected: PASS; `all golden runs match`.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/cli scenarios/golden.json
git commit -m "feat(cli): golden runs pin canonical trace fingerprints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Documentation and verification

**Files:** Modify `docs/adaptations.md`, `docs/superpowers/plans/2026-11-10-contract-changes-for-plans-2-3.md`.

- [ ] **Step 1: Add adaptation rows** to `docs/adaptations.md`:

```markdown
| A-019 | Threat: the victim is reselected every 1 s (ThreatManager.h line 94), immediately when a taunt starts or ends, and immediately when the victim dies; fixate is not modelled; equal threat goes to the lowest id. | Deterministic port of ThreatManager; fixate is not needed for Festergut. | `threat.test.ts`, `taunt.test.ts` |
| A-020 | Triggered casts ignore cast time, GCD, cooldown, the casting state and range. | Matches the use of `CastSpell(..., true)` in the Festergut script; to be checked against TriggerCastFlags per spell in Plan 2b. | `boss-targeting.test.ts` |
| A-021 | Boss target selection measures distance edge to edge (A-003) and picks uniformly at random from its own stream; SelectTarget's position argument is not modelled. | Same distance rule as everywhere else. | `boss-targeting.test.ts` |
| A-022 | Boss melee: miss, dodge and parry from the victim's configured avoidance; no crits, crushing blows, glancing blows or block; no leeway range bonus; the swing timer is ready at engage. | Avoidance comes from stand-in profiles until Plan 3 models player defense. | `melee.test.ts` |
| A-023 | The plan action `taunt` uses generic values (30 yd, 8 s cooldown, 3 s) for every actor. | Until Plan 3 gives each spec its own taunt spell from client data. | `taunt.test.ts` |
| A-024 | Spell scripts run after all effects of a spell were applied to a target; aura scripts run after the apply, stack or remove event. | AzerothCore runs hooks per effect; the order matters per script and is checked in Plan 2b. | `aura-scripts.test.ts` |
```

- [ ] **Step 2: Mark the contract list** — in `2026-11-10-contract-changes-for-plans-2-3.md`, append "(done in Plan 2a)" to Plan 2 items 1, 2, 3 (triggered casts; casting as another unit remains for Gate 4), 4, 5, 6, 7, 9 and 10, and "(partly: `clearTimer`)" to item 8.

- [ ] **Step 3: Full verification**

Run each and check the expected result:
- `pnpm test` → all files PASS
- `pnpm typecheck` → no output
- `pnpm golden` → `all golden runs match`
- `pnpm sim run scenarios/training-dummy/clean.yaml` → `… kill at …`, three `PASS` lines
- `grep -rn "Math.hypot\|Math.random\|Date.now\|new Date" packages/*/src || echo clean` → `clean`
- `grep -rnE "from '(\.\./)+(content|cli|format|tools)|@raid/(content|cli|format|tools)" packages/engine/src || echo "engine clean"` → `engine clean`

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: adaptations and contract status after plan 2a

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## What Plan 2b will do

1. Owner extracts the six DBC files and runs `pnpm extract-spells` for the Festergut spell ids (research notes) → `packages/content/data/spelldata/festergut.json`; versions go into `PINS.spellDataVersions`.
2. Festergut data entries: creature stats (`db` sources), derived health/melee/armor (`derived` with the formulas above), spell values (`spelldata` sources), engine-side choices (`assumption`).
3. Festergut boss module and script (EventMap port of `boss_festergut.cpp`), aura and spell scripts for Blighted Spores, Gastric Bloat and Pungent Blight, the gas dummy's ambient blight.
4. Gate 1 scenarios (clean kill, missed spore group, late tank swap) with custom observation checks, English ability names, golden runs.
5. A check of A-020 and A-024 against the spells' actual trigger flags and effect order.

