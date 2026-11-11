# Plan 2b-1 — Engine Extensions for Festergut (Gate 1, Plan 2 of 3, part b-1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every engine rule the Festergut 25-player normal script needs, built boss-agnostically and in the research's priority order: school masks, AzerothCore area geometry with caster-relative filters, area damage avoidance, the launch/hit split with per-target effect hooks, max targets from a named stream, the player-caster area rules, periodic amounts fixed at application, the aura replacement scope, removal hooks on death with death-persistent auras, casting as another unit, the effect types `trigger_spell`, `force_cast`, `periodic_trigger` and `instakill`, attack-speed and scale auras, corrected `selectTarget` bounds with `playersOnly` and a count helper, engage with a `who`, difficulty-variant resolution, and a loader that turns the client spell extraction into sourced data entries.

**Architecture:** The engine gains small focused modules — `schools.ts` (school masks), `area.ts` (area membership and max targets), `launch.ts` (spell launch and per-unit hit), `stats.ts` (attack speed and scale), `engage.ts` (engage with a puller) — and extends `catalog`, `effects`, `auras`, `casting`, `modifiers`, `melee`, `movement`, `boss`, `sim`, `units` and `run`. Spells resolve through `launchSpell`; aura ticks and on-expire effects keep using `applyEffects`. `@raid/content` gains `src/spelldata/` (file shape, difficulty variants, sourced entries). No boss code is written here; Festergut follows in Plan 2b-2.

**Tech Stack:** as Plan 2a; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-festergut-pilot-design.md` (rev. 2; §6 accuracy contract, §7 provenance, §8 simulation rules, §11 testing). **Research:** `docs/research/festergut-mechanics-25n.md` (section 10 is the contract list this plan implements; its source abbreviations `SP`, `SE`, `SAE`, `SA`, `SI`, `SM`, `U`, `CR`, `UAI.h`, `CAI`, `TM` are used below as full paths), `docs/research/festergut-azerothcore.md`. **Contract list:** `docs/superpowers/plans/2026-11-10-contract-changes-for-plans-2-3.md`.

---

## Why Plan 2b is split

The research found fifteen engine contract changes before a Festergut script can be correct (research §10, P1 and P2). Building them together with the boss script would make one plan too large to review and would mix engine rules (which must stay boss-agnostic, spec §12) with boss content. Plan 2b-1 builds the engine rules, each with its own tests against small invented units and spells. Plan 2b-2 (last section) writes the Festergut module, its data, the Gate 1 scenarios and the golden runs on top of them.

## Conventions

As Plan 2a:
- Run from `E:\raid-explainer` in Git Bash. Start each shell with `pnpm() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm "$@"; }`.
- TDD: write the failing test, run it and watch it fail, implement, run it and watch it pass, commit.
- Before every commit run the full suite, the type check and the golden runs: `pnpm test && pnpm typecheck && pnpm golden`. Expected: every test passes, no type errors, `all golden runs match`.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Changing an existing file: read it first; the snippets below show the exact code to replace (`Replace … with …`) or add. Keep everything else unchanged.
- Every behaviour change to an existing rule updates `docs/adaptations.md` and the affected tests in the same task; each such task lists them under **Changed behaviour**.
- **Canonical traces.** No task in this plan is meant to change the canonical trace of an existing scenario: the training dummy and the engine dummy fixture use single-school spells without areas, travel or periodic auras, and keep `pull`. So the pinned fingerprint in `packages/engine/test/run.test.ts` and `scenarios/golden.json` stay as they are. If `pnpm golden` or the fingerprint test reports a change, stop and find the cause; never update a fingerprint in this plan. (Plan 2b-2 adds and pins new golden runs deliberately.)
- Test counts given as "Expected: PASS (n tests)" refer to the named file.

## Design decisions

1. **School sets, not raw masks, inside the engine.** `SchoolSet = School | readonly School[]`; masks appear only at the data boundary (`schoolMask`, `schoolsOfMask`). The trace keeps a string: the school name, or names joined by `+` in mask bit order (`nature+shadow`). Single-school traces stay byte-identical.
2. **One area model.** `area` effects get `center` (`caster` | `target`), `relation` to the caster (`enemy` | `ally` | `any`), `playersOnly`, `excludeCaster`, `maxTargets`; the old `includeCenter`/`filter` fields go. Membership is centre distance ≤ radius, plus the target's combat reach only for a player caster hitting a creature (Spell.cpp 9504–9521).
3. **Launch, then hit** (`launch.ts`): units are collected per effect; then, per unit in order of first appearance and per effect in effect order, damage is fixed (and `trigger_spell` is cast) like `DoAllEffectOnLaunchTarget`; then each unit is hit (`spell_hit`, auras, `onEffectHitTarget` hook before the default handler, fixed damage, `afterHitTarget`). Read at the pinned commit: `HandleLaunchPhase` runs in `Spell::_cast` (Spell.cpp 4091) before the delayed-spell branch (4157), so travelling spells also fix damage at launch.
4. **Player-caster area rule** uses the number of units the spell hits (`m_UniqueTargetInfo.size()`, Spell.cpp 8730–8735); the creature-AoE avoidance uses the casting unit's kind (AzerothCore checks the original caster, which defaults to the caster).
5. **Periodic amounts are fixed at application** (roll, caster damage-done factors, × stacks; `AuraEffect::CalculateAmount`) and recomputed on every re-application; taken and area factors apply per tick. Recomputing on a refresh without a stack change is recorded as an assumption in A-029.
6. **Rounding follows AzerothCore (owner review decision, overrides the earlier "one rounding" wording below).** Spell damage is truncated to a whole number after each modifier step in AzerothCore's order (damage done, then damage taken, then the area reduction), exactly as melee already does (A-022). Wherever a task below says "rounded once (A-017)", implement per-step truncation instead and update A-017 and A-026 accordingly. Existing traces should stay identical because the current scenarios apply no spell modifiers; if `pnpm golden` changes, stop and find the cause.
7. **`afterRemove` always runs**, also for reason `death` and on a dead holder (SpellAuraEffects.cpp 755–804). Two existing tests change.
8. **Attack speed** follows `Unit::ApplyAttackTimePercentMod` as read at the pinned commit (Unit.cpp 13135–13152): each effect multiplies the interval by 100/(100+pct) (slows by (100+|pct|)/100), the remaining swing time is rescaled, and per-swing damage is unchanged because `GetAttackTime` (used by the damage formula) stays unhasted.
9. **`countTargets` draws no random numbers** (AzerothCore's `SelectTargetList` draws on a global generator that has no counterpart with named streams).
10. **Zone-in-combat runs before the script's engage code** (BossAI's `_JustEngagedWith` calls `DoZoneInCombat` first); the 250 yd limit is not modelled.
11. **Not built here:** LINKED auras (only Vile Gas's slow/confuse 69248 uses one; it is a P3 limitation), spell hit/resist and crits (P3), missile delay of Vile Gas (P3). Plan 2b-2 lists them as omissions.
12. **The spell-data loader lives in `@raid/content`** without a schema library: it checks the file's structure and pins, and `DataRegistry` validates every entry it builds.

## File map (new and changed)

```
docs/sources.md, docs/adaptations.md, docs/superpowers/plans/2026-11-10-contract-changes-for-plans-2-3.md   (updated)
packages/engine/src/schools.ts      school masks, overlap, trace labels (new)
packages/engine/src/area.ts         area membership, centres, max-target subsets (new)
packages/engine/src/launch.ts       spell launch and per-unit hit (new)
packages/engine/src/stats.ts        attack-speed and scale auras (new)
packages/engine/src/engage.ts       engage with a puller (new)
packages/engine/src/catalog.ts      effect, modifier, aura and spell definitions; validation
packages/engine/src/effects.ts      effects outside a launch (aura ticks, on-expire); rollDamage
packages/engine/src/auras.ts        aura options, periodic amounts, replacement, death removal, stat refresh
packages/engine/src/casting.ts      cast options; completion hands over to launchSpell
packages/engine/src/modifiers.ts    school sets, area damage factors, damage routes
packages/engine/src/melee.ts, movement.ts, boss.ts, sim.ts, units.ts, run.ts, index.ts
packages/engine/test/*.test.ts      new test files per task; auras, aura-scripts, boss-targeting, movement, run, sim tests updated
packages/content/src/spelldata/     file.ts, variants.ts, entries.ts (new)
packages/content/src/index.ts       exports
packages/content/test/spelldata-variants.test.ts, spelldata-entries.test.ts (new)
```

---

### Task 0: Sources for the new rules

**Files:** Modify `docs/sources.md`.

- [ ] **Step 1: Append these rows to the "Files referenced so far" table in `docs/sources.md`:**

```markdown
| `src/server/game/Spells/Spell.cpp` lines 1002–1011, 1414–1419, 2161, 2885–2957, 3253, 3336–3354, 4031–4177, 5866–5871, 8619–8745, 9504–9521 | Area targets, shared target lists, max targets, launch and hit order, area damage reduction, player area cap (`area.ts`, `launch.ts`) |
| `src/server/game/Spells/SpellEffects.cpp` lines 279–292, 330–333, 808–812, 1043–1098 | Instakill, school damage at launch, trigger spell, force cast (`launch.ts`, `effects.ts`) |
| `src/server/game/Spells/Auras/SpellAuraEffects.cpp` lines 557–580, 755–804, 926–950, 4830–4858, 6252, 6398–6405 | Aura amounts × stacks, remove hooks for every mode, periodic tick before expiry, attack speed, periodic trigger, periodic area reduction (`auras.ts`, `stats.ts`) |
| `src/server/game/Spells/Auras/SpellAuras.cpp` lines 2131–2151, 2193–2210 | Area auras of different casters replace each other (`auras.ts`) |
| `src/server/game/Spells/SpellInfo.cpp` lines 409–447, 554–557, 1262, 1655–1674 | Effect value from basePoints and dieSides, radius 0, death-persistent auras, ignoring caster modifiers (`spelldata/entries.ts`, `catalog.ts`) |
| `src/server/game/Spells/SpellMgr.cpp` lines 538–578 | Difficulty variants with the heroic fallback (`spelldata/variants.ts`) |
| `src/server/game/Entities/Unit/Unit.cpp` lines 774–788, 5424–5443, 6026–6050, 6116–6124, 8896–8897, 12829–12835, 13135–13152, 16030–16036 | Combat range, death removal, damage-done percentages, school-mask overlap, no creature crits, scale, attack time, area damage reduction |
| `src/server/game/Entities/Creature/Creature.cpp` lines 2893–2937, 3591–3607 | Engagement start, combat reach from scale |
| `src/server/game/AI/CoreAI/UnitAI.h` lines 53–100, 238–262, 282–343 | SelectTarget distance rules and target lists (`boss.ts`) |
| `src/server/game/AI/CreatureAI.cpp` lines 117–162, 286–295 | DoZoneInCombat and engagement (`boss.ts`, `engage.ts`) |
| `src/server/game/Combat/ThreatManager.cpp` lines 410–524, 650–713 | The first threat reference becomes the victim (`engage.ts`) |
| `src/server/shared/SharedDefines.h` lines 288–290, 374–635, 767–906, 1414–1495; `src/server/game/Spells/Auras/SpellAuraDefines.h` lines 66–347 | School masks, attributes, effect, target and aura ids |
```

- [ ] **Step 2: Commit**

```bash
git add docs/sources.md
git commit -m "docs: sources for the plan 2b-1 engine rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: School masks with overlap (research §10.3)

Spells in this fight have school mask 40 (nature + shadow); modifiers match by mask overlap (Inoculated 32, Inhaled Blight 1, Berserk 127). This task is first because the area modifier (Task 3) matches schools by overlap.

**Files:**
- Create: `packages/engine/src/schools.ts`, `packages/engine/test/schools.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/modifiers.ts`, `packages/engine/src/sim.ts`, `packages/engine/src/index.ts`

**Changed behaviour:** none for existing content: a single school matches and is traced exactly as before.

- [ ] **Step 1: Write the failing test** `packages/engine/test/schools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { applyEffects } from '../src/effects';
import { damageMultiplier } from '../src/modifiers';
import { EventClass } from '../src/queue';
import { overlaps, schoolLabel, schoolMask, schoolsOfMask } from '../src/schools';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 2, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  return sim;
}

describe('school masks', () => {
  it('converts school sets to SpellSchoolMask bits and back', () => {
    expect(schoolMask('physical')).toBe(1);
    expect(schoolMask('shadow')).toBe(32);
    expect(schoolMask(['shadow', 'nature'])).toBe(40);
    expect(schoolsOfMask(40)).toEqual(['nature', 'shadow']);
    expect(schoolsOfMask(127)).toEqual(['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane']);
  });

  it('rejects empty sets and masks outside 1..127', () => {
    expect(() => schoolMask([])).toThrow(/at least one school/);
    expect(() => schoolsOfMask(0)).toThrow(/invalid school mask 0/);
    expect(() => schoolsOfMask(128)).toThrow(/invalid school mask 128/);
  });

  it('matches by overlap and labels several schools in bit order', () => {
    expect(overlaps(['nature', 'shadow'], 'shadow')).toBe(true);
    expect(overlaps(['nature', 'shadow'], ['physical', 'fire'])).toBe(false);
    expect(schoolLabel('fire')).toBe('fire');
    expect(schoolLabel(['shadow', 'nature'])).toBe('nature+shadow');
  });
});

describe('damage with several schools', () => {
  it('a shadow modifier applies to nature + shadow damage, a physical one does not; the trace shows the label', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'shadow_ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false, schools: ['shadow'] }] });
    sim.catalog.addAura({ id: 'stone_skin', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false, schools: ['physical'] }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'shadow_ward', 'p1', 'p1', []);
      applyAura(sim, 'stone_skin', 'p1', 'p1', []);
      expect(damageMultiplier(sim, 'boss', 'p1', ['nature', 'shadow'])).toBe(0.5);
      expect(damageMultiplier(sim, 'boss', 'p1', 'nature')).toBe(1);
      applyEffects(sim, [{ type: 'damage', school: ['nature', 'shadow'], min: 1000, max: 1000 }], { casterId: 'boss', targetId: 'p1', ability: 'vile_gas', causes: [] });
    });
    sim.run();
    expect(sim.trace.list().find((e) => e.kind === 'damage')?.data).toMatchObject({ school: 'nature+shadow', amount: 500 });
  });

  it('rejects an empty school list in a spell or a modifier', () => {
    const sim = newSim();
    expect(() =>
      sim.catalog.addSpell({ id: 'nothing', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: true, target: 'self', effects: [{ type: 'damage', school: [], min: 1, max: 1 }] }),
    ).toThrow(/nothing: a school set needs at least one school/);
    expect(() =>
      sim.catalog.addAura({ id: 'nowhere', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -10, perStack: false, schools: [] }] }),
    ).toThrow(/nowhere: a school set needs at least one school/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/schools.test.ts`
Expected: FAIL, cannot resolve `../src/schools`.

- [ ] **Step 3: Write `packages/engine/src/schools.ts`:**

```ts
import type { School, SchoolSet } from './catalog';

/** SpellSchoolMask bits (SharedDefines.h lines 288–290 at the pinned commit). */
export const SCHOOL_BITS: Readonly<Record<School, number>> = {
  physical: 1,
  holy: 2,
  fire: 4,
  nature: 8,
  frost: 16,
  shadow: 32,
  arcane: 64,
};

const ORDER: readonly School[] = ['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane'];

/** SPELL_SCHOOL_MASK_ALL. */
export const ALL_SCHOOLS_MASK = 127;

export function schoolMask(s: SchoolSet): number {
  const list: readonly School[] = typeof s === 'string' ? [s] : s;
  let mask = 0;
  for (const school of list) {
    const bit = SCHOOL_BITS[school];
    if (bit === undefined) throw new Error(`unknown school ${school}`);
    mask |= bit;
  }
  if (mask === 0) throw new Error('a school set needs at least one school');
  return mask;
}

/** The schools of a SpellSchoolMask, in bit order. */
export function schoolsOfMask(mask: number): School[] {
  if (!Number.isInteger(mask) || mask <= 0 || mask > ALL_SCHOOLS_MASK) throw new Error(`invalid school mask ${mask}`);
  return ORDER.filter((s) => (mask & SCHOOL_BITS[s]) !== 0);
}

/** Misc-value mask matching (Unit.cpp 6116–6124): two school sets match when they share a school. */
export function overlaps(a: SchoolSet, b: SchoolSet): boolean {
  return (schoolMask(a) & schoolMask(b)) !== 0;
}

/** Trace label: the school name, or several joined by '+' in bit order ('nature+shadow'). */
export function schoolLabel(s: SchoolSet): string {
  return schoolsOfMask(schoolMask(s)).join('+');
}
```

- [ ] **Step 4: Extend `packages/engine/src/catalog.ts`.**

Replace
```ts
import type { Simulation } from './sim';
import { ID_PATTERN } from './units';
```
with
```ts
import { schoolMask } from './schools';
import type { Simulation } from './sim';
import { ID_PATTERN } from './units';
```

Replace
```ts
export type School = 'physical' | 'holy' | 'fire' | 'nature' | 'frost' | 'shadow' | 'arcane';

export type Effect =
  | { readonly type: 'damage'; readonly school: School; readonly min: number; readonly max: number }
```
with
```ts
export type School = 'physical' | 'holy' | 'fire' | 'nature' | 'frost' | 'shadow' | 'arcane';

/** One school, or several: a spell school mask such as nature + shadow (40). */
export type SchoolSet = School | readonly School[];

export type Effect =
  | { readonly type: 'damage'; readonly school: SchoolSet; readonly min: number; readonly max: number }
```

Replace
```ts
  /** Limit to these schools; all schools when absent. */
  readonly schools?: readonly School[];
```
with
```ts
  /** Applies when these schools overlap the damage's schools (misc-value mask match); all schools when absent. */
  readonly schools?: readonly School[];
```

Insert before `export class Catalog {`:
```ts
function checkSchools(owner: string, schools: SchoolSet): void {
  try {
    schoolMask(schools);
  } catch (e) {
    throw new Error(`${owner}: ${(e as Error).message}`);
  }
}

/** Validates effect definitions; later tasks add rules per effect type. */
function checkEffects(owner: string, effects: readonly Effect[]): void {
  for (const e of effects) {
    if (e.type === 'damage') checkSchools(owner, e.school);
    if (e.type === 'area') checkEffects(owner, e.effects);
  }
}

```

In `addSpell`, replace
```ts
      throw new Error(`negative timing or range in spell ${def.id}`);
    }
    this.spells.set(def.id, def);
```
with
```ts
      throw new Error(`negative timing or range in spell ${def.id}`);
    }
    checkEffects(def.id, def.effects);
    this.spells.set(def.id, def);
```

In `addAura`, replace
```ts
    for (const m of def.modifiers ?? []) {
      if (!Number.isFinite(m.pct)) throw new Error(`aura ${def.id} has a non-finite modifier percentage`);
    }
    this.auras.set(def.id, def);
```
with
```ts
    for (const m of def.modifiers ?? []) {
      if (!Number.isFinite(m.pct)) throw new Error(`aura ${def.id} has a non-finite modifier percentage`);
      if (m.schools !== undefined) checkSchools(def.id, m.schools);
    }
    checkEffects(def.id, [...(def.periodic?.effects ?? []), ...(def.onExpire ?? [])]);
    this.auras.set(def.id, def);
```

- [ ] **Step 5: Replace `packages/engine/src/modifiers.ts` with:**

```ts
import type { DamageModifier, SchoolSet } from './catalog';
import { overlaps } from './schools';
import type { Simulation } from './sim';
import { compareStrings, type Unit } from './units';

/** A modifier applies when its schools overlap the damage's schools (Unit.cpp 6116–6124); all schools when it names none. */
function applies(m: DamageModifier, school: SchoolSet): boolean {
  return !m.schools || overlaps(m.schools, school);
}

function factor(sim: Simulation, unit: Unit, kind: DamageModifier['kind'], school: SchoolSet): number {
  let f = 1;
  for (const key of [...unit.auras.keys()].sort(compareStrings)) {
    const inst = unit.auras.get(key)!;
    for (const m of sim.catalog.aura(inst.auraId).modifiers ?? []) {
      if (m.kind !== kind || !applies(m, school)) continue;
      f *= Math.max(0, 1 + (m.pct * (m.perStack ? inst.stacks : 1)) / 100);
    }
  }
  return f;
}

/** Product of the source's damage-done modifiers for the schools (1 when the source no longer exists). */
export function damageDoneFactor(sim: Simulation, sourceId: string, school: SchoolSet): number {
  const source = sim.units.get(sourceId);
  return source ? factor(sim, source, 'damage_done_pct', school) : 1;
}

/** Product of the target's damage-taken modifiers for the schools. */
export function damageTakenFactor(sim: Simulation, targetId: string, school: SchoolSet): number {
  return factor(sim, sim.unit(targetId), 'damage_taken_pct', school);
}

/** Product of the source's damage-done and the target's damage-taken modifiers, never negative (spell effects). */
export function damageMultiplier(sim: Simulation, sourceId: string, targetId: string, school: SchoolSet): number {
  return Math.max(0, damageDoneFactor(sim, sourceId, school) * damageTakenFactor(sim, targetId, school));
}
```

- [ ] **Step 6: Trace the label in `packages/engine/src/sim.ts`.**

Replace
```ts
import { Catalog, type School } from './catalog';
```
with
```ts
import { Catalog, type SchoolSet } from './catalog';
import { schoolLabel } from './schools';
```

Replace
```ts
  readonly ability: string;
  readonly school: School;
}
```
with
```ts
  readonly ability: string;
  /** Schools of the damage; traced as a label such as 'nature+shadow'. */
  readonly school: SchoolSet;
}
```

Replace
```ts
      { target: u.id, source: info.sourceId, ability: info.ability, school: info.school, amount: dealt, overkill: rounded - dealt },
```
with
```ts
      { target: u.id, source: info.sourceId, ability: info.ability, school: schoolLabel(info.school), amount: dealt, overkill: rounded - dealt },
```

In `packages/engine/src/index.ts` add after `export * from './run';`:
```ts
export * from './schools';
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/schools.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden` (expected as in Conventions).

```bash
git add packages/engine
git commit -m "feat(engine): school sets with mask overlap for damage and modifiers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Area geometry and caster-relative filters (research §10.1, rewrites A-003)

**Files:**
- Create: `packages/engine/src/area.ts`, `packages/engine/test/area.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/effects.ts`, `packages/engine/src/movement.ts`, `packages/engine/src/index.ts`, `docs/adaptations.md`
- Test changes: `packages/engine/test/auras.test.ts`, `packages/engine/test/movement.test.ts`

**Changed behaviour:** areas used the distance from the centre to the unit's edge (`pointToEdge`); now centre distance ≤ radius (Spell.cpp 9504–9521), plus the target's reach only when a player hits a creature. The `filter`/`includeCenter` fields are replaced by `center`/`relation`/`playersOnly`/`excludeCaster`. Updated: A-003; `auras.test.ts` (unit positions of the boundary test, the two area definitions); `movement.test.ts` (the `pointToEdge` test is removed, `area.test.ts` replaces it).

- [ ] **Step 1: Write the failing test** `packages/engine/test/area.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AreaEffect } from '../src/catalog';
import { applyEffects } from '../src/effects';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 1000000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 1, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', combatReach: 8, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'add', name: 'Add', kind: 'creature', role: 'add', combatReach: 3, pos: { x: 0, y: 5 } });
  sim.addUnit({ ...body, id: 'p_at', name: 'At', kind: 'player', role: 'ranged', pos: { x: 8, y: 0 } });
  sim.addUnit({ ...body, id: 'p_out', name: 'Out', kind: 'player', role: 'ranged', pos: { x: -8.01, y: 0 } });
  sim.addUnit({ ...body, id: 'p_in', name: 'In', kind: 'player', role: 'ranged', pos: { x: 0, y: -7.99 } });
  return sim;
}

function hits(area: Omit<AreaEffect, 'type' | 'effects'>, casterId: string, targetId = casterId): string[] {
  const sim = newSim();
  sim.at(0, EventClass.SpellHit, () =>
    applyEffects(sim, [{ type: 'area', ...area, effects: [{ type: 'damage', school: 'shadow', min: 1, max: 1 }] }], { casterId, targetId, ability: 'test', causes: [] }),
  );
  sim.run();
  return sim.trace.list().filter((e) => e.kind === 'damage').map((e) => e.data.target as string);
}

describe('area targets (A-003)', () => {
  it('uses the centre distance without the target reach: exactly at the radius is inside', () => {
    // p_at 8.00 (in), p_in 7.99 (in), p_out 8.01 (out); with the old edge rule p_out (6.51 to its edge) was hit.
    expect(hits({ radius: 8, center: 'caster', relation: 'enemy' }, 'boss')).toEqual(['p_at', 'p_in']);
  });

  it('selects by relation to the caster, players only, and can exclude the caster', () => {
    expect(hits({ radius: 8, center: 'caster', relation: 'ally' }, 'boss')).toEqual(['add', 'boss']);
    expect(hits({ radius: 8, center: 'caster', relation: 'ally', excludeCaster: true }, 'boss')).toEqual(['add']);
    expect(hits({ radius: 8, center: 'caster', relation: 'any', playersOnly: true }, 'boss')).toEqual(['p_at', 'p_in']);
    expect(hits({ radius: 8, center: 'caster', relation: 'ally' }, 'p_at')).toEqual(['p_at']);
  });

  it('centres on the explicit target when asked', () => {
    expect(hits({ radius: 0.5, center: 'target', relation: 'enemy' }, 'boss', 'p_in')).toEqual(['p_in']);
  });

  it('adds the target combat reach when a player caster hits a creature', () => {
    // p_at → add: centre 9.434 <= 6.5 + 3; p_at → boss: 8 <= 6.5 + 8.
    expect(hits({ radius: 6.5, center: 'caster', relation: 'enemy' }, 'p_at')).toEqual(['add', 'boss']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/area.test.ts`
Expected: FAIL with assertion errors (vitest does not type-check; the old area code ignores `center`, `relation`, `playersOnly` and `excludeCaster`, and with `filter` undefined it hits only creatures other than the centre unit).

- [ ] **Step 3: Replace the effect union in `packages/engine/src/catalog.ts`.**

Replace
```ts
export type Effect =
  | { readonly type: 'damage'; readonly school: SchoolSet; readonly min: number; readonly max: number }
  | { readonly type: 'heal'; readonly min: number; readonly max: number }
  | { readonly type: 'apply_aura'; readonly aura: string }
  | { readonly type: 'remove_aura'; readonly aura: string }
  | { readonly type: 'taunt'; readonly durationMs: number }
  | {
      readonly type: 'area';
      readonly radius: number;
      readonly includeCenter: boolean;
      readonly filter: 'players' | 'creatures' | 'all';
      readonly effects: readonly Effect[];
    };
```
with
```ts
export interface DamageEffect {
  readonly type: 'damage';
  readonly school: SchoolSet;
  readonly min: number;
  readonly max: number;
}

/** An effect on one unit. */
export type LeafEffect =
  | DamageEffect
  | { readonly type: 'heal'; readonly min: number; readonly max: number }
  | { readonly type: 'apply_aura'; readonly aura: string }
  | { readonly type: 'remove_aura'; readonly aura: string }
  | { readonly type: 'taunt'; readonly durationMs: number };

/**
 * Effects on every unit in an area (implicit targets UNIT_SRC_AREA_* around the caster, UNIT_DEST_AREA_* around the
 * explicit target). Membership: centre distance <= radius (A-003).
 */
export interface AreaEffect {
  readonly type: 'area';
  readonly radius: number;
  /** 'caster': SRC_CASTER; 'target': the explicit target's position (for an aura effect: the holder's). */
  readonly center: 'caster' | 'target';
  /** Relation to the caster: enemy = the other side (players vs creatures), ally = the caster's side, any = both. */
  readonly relation: 'enemy' | 'ally' | 'any';
  /** SPELL_ATTR3_ONLY_ON_PLAYER (Spell.cpp 2161). */
  readonly playersOnly?: boolean;
  /** SPELL_ATTR1_EXCLUDE_CASTER: the caster is never hit (ally and any areas include it otherwise). */
  readonly excludeCaster?: boolean;
  readonly effects: readonly LeafEffect[];
}

export type Effect = LeafEffect | AreaEffect;
```

In `checkEffects`, replace
```ts
    if (e.type === 'area') checkEffects(owner, e.effects);
```
with
```ts
    if (e.type === 'area') {
      if (!Number.isFinite(e.radius) || e.radius < 0) throw new Error(`${owner}: invalid area radius ${e.radius}`);
      checkEffects(owner, e.effects);
    }
```

- [ ] **Step 4: Write `packages/engine/src/area.ts`:**

```ts
import type { AreaEffect } from './catalog';
import { centerDistance, positionAt } from './movement';
import type { Simulation } from './sim';
import type { Unit, Vec2 } from './units';

/** Whether `u` has the given relation to the caster: players and creatures are opposite sides. */
export function relationMatches(relation: AreaEffect['relation'], caster: Unit, u: Unit): boolean {
  if (relation === 'any') return true;
  const sameSide = caster.kind === u.kind;
  return relation === 'ally' ? sameSide : !sameSide;
}

/** The area's centre now: the caster's position, or the explicit target's (the holder's for aura effects). */
export function areaCenter(sim: Simulation, area: AreaEffect, casterId: string, targetId: string): Vec2 {
  return positionAt(sim.unit(area.center === 'caster' ? casterId : targetId), sim.now);
}

/**
 * Living units in the area, sorted by id (Spell.cpp 9504–9521, A-003): centre distance from the area centre <= radius;
 * the unit's combat reach is added only when a player caster hits a creature.
 */
export function areaTargets(sim: Simulation, caster: Unit, area: AreaEffect, center: Vec2): Unit[] {
  return sim.sortedUnits((u) => {
    if (!u.alive) return false;
    if (area.excludeCaster && u.id === caster.id) return false;
    if (!relationMatches(area.relation, caster, u)) return false;
    if (area.playersOnly && u.kind !== 'player') return false;
    const reach = caster.kind === 'player' && u.kind === 'creature' ? u.combatReach : 0;
    return centerDistance(center, positionAt(u, sim.now)) <= area.radius + reach;
  });
}
```

- [ ] **Step 5: Replace `packages/engine/src/effects.ts` with:**

```ts
import { areaCenter, areaTargets } from './area';
import { applyAura, removeAuras } from './auras';
import type { Effect, LeafEffect } from './catalog';
import { damageMultiplier } from './modifiers';
import type { Simulation } from './sim';
import { threatFor } from './threat';

export interface EffectContext {
  readonly casterId: string;
  readonly targetId: string;
  readonly ability: string;
  readonly causes: readonly string[];
}

export function applyEffects(sim: Simulation, effects: readonly Effect[], ctx: EffectContext): void {
  for (const e of effects) applyEffect(sim, e, ctx);
}

function applyEffect(sim: Simulation, e: Effect, ctx: EffectContext): void {
  switch (e.type) {
    case 'area': {
      const hit = areaTargets(sim, sim.unit(ctx.casterId), e, areaCenter(sim, e, ctx.casterId, ctx.targetId));
      for (const u of hit) applyEffects(sim, e.effects, { ...ctx, targetId: u.id });
      return;
    }
    default:
      applyLeafEffect(sim, e, ctx);
  }
}

/** One effect on one unit. */
export function applyLeafEffect(sim: Simulation, e: LeafEffect, ctx: EffectContext): void {
  const target = sim.unit(ctx.targetId);
  switch (e.type) {
    case 'damage': {
      if (!target.alive) return;
      const rolled = sim.rng.stream(`unit:${ctx.casterId}.amount`).int(e.min, e.max);
      const amount = rolled * damageMultiplier(sim, ctx.casterId, target.id, e.school);
      sim.damage(target.id, amount, { sourceId: ctx.casterId, ability: ctx.ability, school: e.school }, ctx.causes);
      return;
    }
    case 'heal': {
      if (!target.alive) return;
      const amount = sim.rng.stream(`unit:${ctx.casterId}.amount`).int(e.min, e.max);
      sim.heal(target.id, amount, { sourceId: ctx.casterId, ability: ctx.ability, school: 'holy' }, ctx.causes);
      return;
    }
    case 'apply_aura':
      applyAura(sim, e.aura, ctx.casterId, target.id, ctx.causes);
      return;
    case 'remove_aura':
      removeAuras(sim, target.id, e.aura, 'removed', ctx.causes);
      return;
    case 'taunt':
      threatFor(sim)?.taunt(target.id, ctx.casterId, e.durationMs, ctx.causes);
      return;
  }
}
```

- [ ] **Step 6: Remove the edge-based area distance.** In `packages/engine/src/movement.ts` delete

```ts
/** Area check: distance from an area centre to a unit's edge, never negative (A-003). */
export function pointToEdge(p: Vec2, u: Unit, t: number): number {
  return Math.max(0, centerDistance(p, positionAt(u, t)) - u.combatReach);
}

```

In `packages/engine/test/movement.test.ts` replace
```ts
import { centerDistance, edgeDistance, pointToEdge, positionAt, travelTimeMs } from '../src/movement';
```
with
```ts
import { centerDistance, edgeDistance, positionAt, travelTimeMs } from '../src/movement';
```
and delete the test
```ts
  it('measures area distance from a point to a unit edge', () => {
    const b = createUnit({ ...base, id: 'b', name: 'B', pos: { x: 9.5, y: 0 } });
    expect(pointToEdge({ x: 0, y: 0 }, b, 0)).toBe(8);
  });

```

- [ ] **Step 7: Update `packages/engine/test/auras.test.ts`.**

Replace
```ts
  sim.addUnit({ ...player, id: 'p2', name: 'P2', pos: { x: 9.5, y: 0 } });
  sim.addUnit({ ...player, id: 'p3', name: 'P3', pos: { x: -9.49, y: 0 } });
  sim.addUnit({ ...player, id: 'p4', name: 'P4', pos: { x: 0, y: -9.51 } });
```
with
```ts
  sim.addUnit({ ...player, id: 'p2', name: 'P2', pos: { x: 8, y: 0 } });
  sim.addUnit({ ...player, id: 'p3', name: 'P3', pos: { x: -7.99, y: 0 } });
  sim.addUnit({ ...player, id: 'p4', name: 'P4', pos: { x: 0, y: -8.01 } });
```

Replace
```ts
      { type: 'area', radius: 8, includeCenter: true, filter: 'players', effects: [{ type: 'damage', school: 'nature', min: 1000, max: 1000 }] },
```
with
```ts
      { type: 'area', radius: 8, center: 'target', relation: 'enemy', effects: [{ type: 'damage', school: 'nature', min: 1000, max: 1000 }] },
```

Replace
```ts
    // p2: edge distance exactly 8 (hit); p3: 7.99 (hit); p4: 8.01 (miss); p1 is the centre.
```
with
```ts
    // p2: centre distance exactly 8 (hit); p3: 7.99 (hit); p4: 8.01 (miss); p1 is the centre (A-003).
```

Replace
```ts
          type: 'area',
          radius: 200,
          includeCenter: true,
          filter: 'all',
```
with
```ts
          type: 'area',
          radius: 200,
          center: 'target',
          relation: 'any',
```

In `packages/engine/src/index.ts` add as the first line:
```ts
export * from './area';
```

- [ ] **Step 8: Rewrite A-003 in `docs/adaptations.md`.** Replace the row starting `| A-003 |` with:

```markdown
| A-003 | Distances are 2D. Range between units = centre distance − both combat reaches, never negative. Area membership = centre distance from the area centre ≤ radius; the unit's combat reach is added only when a player caster hits a creature (Spell.cpp 9504–9521). Areas are centred on the caster or on the explicit target and select units by their relation to the caster (enemy, ally, any; optionally players only, optionally without the caster). | Festergut's room is flat; AzerothCore measures area distances in 3D. | `movement.test.ts`, `area.test.ts`, `auras.test.ts` |
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm test packages/engine/test/area.test.ts packages/engine/test/auras.test.ts packages/engine/test/movement.test.ts`
Expected: PASS (`area.test.ts` 4 tests; the other two files pass unchanged in count except `movement.test.ts`, which has one test fewer).

- [ ] **Step 10: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): areas by centre distance with caster-relative filters (A-003)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Area damage avoidance (research §10.2, adds A-026)

Inoculated (MOD_AOE_DAMAGE_AVOIDANCE) reduces only damage that reaches its holder through an area, directly or as a tick of an aura that an area applied (Spell.cpp 8722–8729, SpellAuraEffects.cpp 6398–6405, Unit.cpp 16030–16036). `damage_taken_pct` would also reduce Gastric Bloat and melee.

**Files:**
- Create: `packages/engine/test/aoe-modifiers.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/modifiers.ts`, `packages/engine/src/effects.ts`, `packages/engine/src/auras.ts`, `packages/engine/src/units.ts`, `docs/adaptations.md`
- Test changes: `packages/engine/test/sim.test.ts` (the hand-built aura instance gets the new field)

**Changed behaviour:** none for existing modifier kinds.

- [ ] **Step 1: Write the failing test** `packages/engine/test/aoe-modifiers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import type { AreaEffect, LeafEffect } from '../src/catalog';
import { applyEffects } from '../src/effects';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const shadow = (n: number) => ({ type: 'damage' as const, school: 'shadow' as const, min: n, max: n });
const around = (effects: LeafEffect[], radius = 30): AreaEffect => ({ type: 'area', radius, center: 'caster', relation: 'enemy', effects });
const ctx = (casterId: string, targetId: string) => ({ casterId, targetId, ability: 'test', causes: [] });

function newSim() {
  const sim = new Simulation({ seed: 6, maxDurationMs: 5000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.addUnit({ ...body, id: 'p2', name: 'P2', kind: 'player', role: 'ranged', pos: { x: 6, y: 0 } });
  sim.catalog.addAura({
    id: 'inoculated',
    durationMs: 120000,
    maxStacks: 3,
    stackScope: 'unit',
    modifiers: [{ kind: 'aoe_damage_taken_pct', pct: -25, perStack: true, schools: ['shadow'] }],
  });
  sim.catalog.addAura({ id: 'cloud', durationMs: 3000, maxStacks: 1, periodic: { intervalMs: 1000, effects: [shadow(1000)] } });
  return sim;
}

const damageTo = (sim: Simulation, id: string) => sim.trace.list().filter((e) => e.kind === 'damage' && e.data.target === id).map((e) => e.data.amount);
const inoculate = (sim: Simulation, id: string, stacks: number) => {
  for (let i = 0; i < stacks; i++) applyAura(sim, 'inoculated', id, id, []);
};

describe('area damage avoidance (A-026)', () => {
  it('reduces area damage per stack for overlapping schools only', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      inoculate(sim, 'p1', 3);
      applyEffects(sim, [around([shadow(1000)])], ctx('boss', 'boss'));
      applyEffects(sim, [around([{ type: 'damage', school: ['nature', 'shadow'], min: 1000, max: 1000 }])], ctx('boss', 'boss'));
      applyEffects(sim, [around([{ type: 'damage', school: 'nature', min: 1000, max: 1000 }])], ctx('boss', 'boss'));
    });
    sim.run();
    expect(damageTo(sim, 'p1')).toEqual([250, 250, 1000]);
    expect(damageTo(sim, 'p2')).toEqual([1000, 1000, 1000]);
  });

  it('does not reduce single-target damage', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      inoculate(sim, 'p1', 3);
      applyEffects(sim, [shadow(1000)], ctx('boss', 'p1'));
    });
    sim.run();
    expect(damageTo(sim, 'p1')).toEqual([1000]);
  });

  it('reduces the ticks of an aura an area applied, not of one applied directly', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      inoculate(sim, 'p1', 1);
      inoculate(sim, 'p2', 1);
      applyEffects(sim, [around([{ type: 'apply_aura', aura: 'cloud' }], 5.5)], ctx('boss', 'boss'));
      applyAura(sim, 'cloud', 'boss', 'p2', []);
    });
    sim.run();
    expect(damageTo(sim, 'p1')).toEqual([750, 750, 750]);
    expect(damageTo(sim, 'p2')).toEqual([1000, 1000, 1000]);
  });

  it('creature AoE avoidance applies only to a creature caster', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'hardened', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'creature_aoe_damage_taken_pct', pct: -50, perStack: false }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'hardened', 'p1', 'p1', []);
      applyEffects(sim, [around([shadow(1000)])], ctx('boss', 'boss'));
      applyEffects(sim, [{ type: 'area', radius: 30, center: 'caster', relation: 'ally', excludeCaster: true, effects: [shadow(1000)] }], ctx('p2', 'p2'));
    });
    sim.run();
    expect(damageTo(sim, 'p1')).toEqual([500, 1000]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/aoe-modifiers.test.ts`
Expected: FAIL — the first test gets `[1000, 1000, 1000]` for `p1` (the new modifier kinds are ignored).

- [ ] **Step 3: Extend `packages/engine/src/catalog.ts`.** Replace

```ts
export interface DamageModifier {
  readonly kind: 'damage_done_pct' | 'damage_taken_pct';
```
with
```ts
export interface DamageModifier {
  /**
   * damage_done_pct / damage_taken_pct: every hit. aoe_damage_taken_pct (MOD_AOE_DAMAGE_AVOIDANCE): only damage that reaches
   * the target through an area; creature_aoe_damage_taken_pct (MOD_CREATURE_AOE_DAMAGE_AVOIDANCE): the same, only from a
   * creature caster (A-026).
   */
  readonly kind: 'damage_done_pct' | 'damage_taken_pct' | 'aoe_damage_taken_pct' | 'creature_aoe_damage_taken_pct';
```

- [ ] **Step 4: Add the area factor to `packages/engine/src/modifiers.ts`.** Replace

```ts
/** Product of the source's damage-done and the target's damage-taken modifiers, never negative (spell effects). */
export function damageMultiplier(sim: Simulation, sourceId: string, targetId: string, school: SchoolSet): number {
  return Math.max(0, damageDoneFactor(sim, sourceId, school) * damageTakenFactor(sim, targetId, school));
}
```
with
```ts
/** How damage reaches its target. */
export interface DamageRoute {
  /** Through an area effect, directly or as a tick of an aura an area applied (A-026). */
  readonly viaArea?: boolean;
}

/** Unit::CalculateAOEDamageReduction (Unit.cpp 16030–16036): AoE avoidance, and creature AoE avoidance for a creature caster. */
export function aoeDamageFactor(sim: Simulation, sourceId: string, targetId: string, school: SchoolSet): number {
  const target = sim.unit(targetId);
  const creatureSource = sim.units.get(sourceId)?.kind === 'creature';
  const creature = creatureSource ? factor(sim, target, 'creature_aoe_damage_taken_pct', school) : 1;
  return factor(sim, target, 'aoe_damage_taken_pct', school) * creature;
}

/** Product of the source's damage-done and the target's damage-taken (and area) modifiers, never negative (spell effects). */
export function damageMultiplier(sim: Simulation, sourceId: string, targetId: string, school: SchoolSet, route: DamageRoute = {}): number {
  const aoe = route.viaArea ? aoeDamageFactor(sim, sourceId, targetId, school) : 1;
  return Math.max(0, damageDoneFactor(sim, sourceId, school) * damageTakenFactor(sim, targetId, school) * aoe);
}
```

- [ ] **Step 5: Carry the route through effects and auras.**

In `packages/engine/src/effects.ts` replace
```ts
  readonly causes: readonly string[];
}
```
with
```ts
  readonly causes: readonly string[];
  /** The effect reaches the target through an area: area modifiers apply (A-026). */
  readonly viaArea?: boolean;
}
```
replace
```ts
      for (const u of hit) applyEffects(sim, e.effects, { ...ctx, targetId: u.id });
```
with
```ts
      for (const u of hit) applyEffects(sim, e.effects, { ...ctx, targetId: u.id, viaArea: true });
```
replace
```ts
      const amount = rolled * damageMultiplier(sim, ctx.casterId, target.id, e.school);
```
with
```ts
      const amount = rolled * damageMultiplier(sim, ctx.casterId, target.id, e.school, { viaArea: ctx.viaArea === true });
```
replace
```ts
      applyAura(sim, e.aura, ctx.casterId, target.id, ctx.causes);
```
with
```ts
      applyAura(sim, e.aura, ctx.casterId, target.id, ctx.causes, { viaArea: ctx.viaArea === true });
```

In `packages/engine/src/units.ts`, in `interface AuraInstance`, replace
```ts
  nextTickMs: number;
  appliedEvent: string;
}
```
with
```ts
  nextTickMs: number;
  appliedEvent: string;
  /** Applied by an area effect: its periodic damage counts as area damage (SpellAuraEffects.cpp 6398–6405). */
  readonly viaArea: boolean;
}
```

In `packages/engine/src/auras.ts` replace
```ts
/** Applies or stacks an aura; returns the event id, or null if the target is dead or the fight is over. */
export function applyAura(
  sim: Simulation,
  auraId: string,
  casterId: string,
  targetId: string,
  causes: readonly string[],
): string | null {
```
with
```ts
export interface ApplyAuraOptions {
  /** The aura comes from an area effect: its periodic damage is area damage (A-026). */
  readonly viaArea?: boolean;
}

/** Applies or stacks an aura; returns the event id, or null if the target is dead or the fight is over. */
export function applyAura(
  sim: Simulation,
  auraId: string,
  casterId: string,
  targetId: string,
  causes: readonly string[],
  options: ApplyAuraOptions = {},
): string | null {
```
replace
```ts
    appliedEvent: '',
  };
```
with
```ts
    appliedEvent: '',
    viaArea: options.viaArea === true,
  };
```
replace
```ts
    applyEffects(sim, periodic.effects, { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [tickId] });
```
with
```ts
    applyEffects(sim, periodic.effects, { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [tickId], viaArea: inst.viaArea });
```

In `packages/engine/test/sim.test.ts` (test "death removes auras with reason death and cancels the cast") replace
```ts
        nextTickMs: 0,
        appliedEvent: '',
      });
```
with
```ts
        nextTickMs: 0,
        appliedEvent: '',
        viaArea: false,
      });
```

- [ ] **Step 6: Add A-026 to `docs/adaptations.md`** (append after A-025):

```markdown
| A-026 | Area damage avoidance: `aoe_damage_taken_pct` (MOD_AOE_DAMAGE_AVOIDANCE) multiplies damage that reaches the target through an area, directly or as a tick of an aura an area applied; `creature_aoe_damage_taken_pct` (MOD_CREATURE_AOE_DAMAGE_AVOIDANCE) does the same only when the casting unit is a creature (Unit::CalculateAOEDamageReduction, Spell.cpp 8722–8729, SpellAuraEffects.cpp 6398–6405). Like the other spell modifiers the factors multiply and the result is rounded once (A-017); AzerothCore truncates after each step. | Single-target damage and melee are not area damage; one rounding rule keeps existing traces unchanged. | `aoe-modifiers.test.ts` |
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/aoe-modifiers.test.ts packages/engine/test/sim.test.ts`
Expected: PASS (`aoe-modifiers.test.ts` 4 tests).

- [ ] **Step 8: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): area damage avoidance modifiers for area-delivered damage (A-026)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Launch/hit split and per-unit effect hooks (research §10.4 and §6, rewrites A-024)

AzerothCore fixes a spell's damage at launch with every modifier, then per unit applies the auras, runs each effect's `OnEffectHitTarget` hook before its default handler, and deals the stored damage last. For Pungent Blight this means Inoculated reduces the hit whose hook removes it.

**Files:**
- Create: `packages/engine/src/launch.ts`, `packages/engine/test/spell-pipeline.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/effects.ts`, `packages/engine/src/casting.ts`, `packages/engine/src/index.ts`, `docs/adaptations.md`

**Changed behaviour:** a spell's damage is rolled and multiplied at cast success instead of at hit (identical for spells without travel time: same stream, same millisecond); auras of a spell are applied before its other effects and its damage last; `afterHitTarget` runs for every unit the spell hits, not only the explicit target; a unit hit by an area now gets its own `spell_hit`. No existing spell has more than one effect or an area, so no existing test changes. Updated: A-024.

- [ ] **Step 1: Write the failing test** `packages/engine/test/spell-pipeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import type { SpellDef } from '../src/catalog';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const instant = { castTimeMs: 0, gcdMs: 0, cooldownMs: 0, usableWhileMoving: true } as const;

function newSim() {
  const sim = new Simulation({ seed: 4, maxDurationMs: 6000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.addUnit({ ...body, id: 'p2', name: 'P2', kind: 'player', role: 'ranged', pos: { x: 6, y: 0 } });
  sim.addUnit({ ...body, id: 'p3', name: 'P3', kind: 'player', role: 'ranged', pos: { x: 40, y: 0 } });
  sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false }] });
  sim.catalog.addAura({ id: 'mark', durationMs: 10000, maxStacks: 1 });
  return sim;
}

const NOVA: SpellDef = {
  ...instant,
  id: 'nova',
  rangeYd: 0,
  target: 'self',
  effects: [
    { type: 'area', radius: 10, center: 'caster', relation: 'enemy', effects: [{ type: 'damage', school: 'shadow', min: 1000, max: 1000 }] },
    { type: 'area', radius: 10, center: 'caster', relation: 'enemy', effects: [{ type: 'apply_aura', aura: 'mark' }] },
    { type: 'on_caster', effects: [{ type: 'script' }] },
  ],
};

describe('spell launch and hit (A-024)', () => {
  it('fixes damage at launch: a hit hook that removes a modifier does not change that hit', () => {
    const sim = newSim();
    sim.catalog.addSpell(NOVA);
    sim.catalog.addSpellScript('nova', {
      onEffectHitTarget: (c) => {
        if (c.effectIndex === 0) removeAuras(c.sim, c.targetId, 'ward', 'removed', c.causes);
      },
    });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'ward', 'p1', 'p1', []);
      startCast(sim, 'boss', 'nova', 'boss', []);
    });
    sim.run();
    const dmg = sim.trace.list().filter((e) => e.kind === 'damage').map((e) => [e.data.target, e.data.amount]);
    expect(dmg).toEqual([['p1', 500], ['p2', 1000]]);
    expect([...sim.unit('p1').auras.keys()]).toEqual(['mark|boss']);
  });

  it('hits each unit in turn: spell_hit, its auras, the hooks in effect order, then the damage', () => {
    const sim = newSim();
    const hooks: string[] = [];
    sim.catalog.addSpell(NOVA);
    sim.catalog.addSpellScript('nova', {
      onEffectHitTarget: (c) => void hooks.push(`${c.targetId}:${c.effectIndex}`),
      afterHitTarget: (c) => void hooks.push(`${c.targetId}:after`),
    });
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'nova', 'boss', []));
    sim.run();
    expect(hooks).toEqual(['p1:0', 'p1:1', 'p1:after', 'p2:0', 'p2:1', 'p2:after', 'boss:2', 'boss:after']);
    const list = sim.trace.list();
    const afterSuccess = list.slice(list.findIndex((e) => e.kind === 'cast_success') + 1).filter((e) => e.t === 0);
    expect(afterSuccess.map((e) => `${e.kind}:${e.data.target ?? e.data.unit}`)).toEqual([
      'spell_hit:p1',
      'aura_applied:p1',
      'damage:p1',
      'spell_hit:p2',
      'aura_applied:p2',
      'damage:p2',
      'spell_hit:boss',
    ]);
  });

  it('runs the hook before the default handler of its effect', () => {
    const sim = newSim();
    const seen: number[] = [];
    sim.catalog.addSpell({ ...instant, id: 'cleanse', rangeYd: 30, target: 'unit', effects: [{ type: 'remove_aura', aura: 'mark' }] });
    sim.catalog.addSpellScript('cleanse', { onEffectHitTarget: (c) => void seen.push(c.sim.unit(c.targetId).auras.size) });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'mark', 'boss', 'p1', []);
      startCast(sim, 'boss', 'cleanse', 'p1', []);
    });
    sim.run();
    expect(seen).toEqual([1]);
    expect(sim.unit('p1').auras.size).toBe(0);
  });

  it('a travelling spell keeps the damage fixed at launch', () => {
    const run = (wardAt: number | null, removeAt: number | null) => {
      const sim = newSim();
      sim.catalog.addSpell({ ...instant, id: 'arrow', rangeYd: 50, target: 'unit', travelSpeedYdPerSec: 10, effects: [{ type: 'damage', school: 'physical', min: 1000, max: 1000 }] });
      if (wardAt !== null) sim.at(wardAt, EventClass.SpellHit, () => void applyAura(sim, 'ward', 'p3', 'p3', []));
      if (removeAt !== null) sim.at(removeAt, EventClass.SpellHit, () => void removeAuras(sim, 'p3', 'ward', 'removed', []));
      sim.at(0, EventClass.Decision, () => void startCast(sim, 'boss', 'arrow', 'p3', []));
      sim.run();
      return sim.trace.list().filter((e) => e.kind === 'damage').map((e) => [e.t, e.data.amount]);
    };
    expect(run(100, null)).toEqual([[4000, 1000]]);
    expect(run(0, 100)).toEqual([[4000, 500]]);
  });

  it('on_caster effects reach the caster of a spell aimed at another unit', () => {
    const sim = newSim();
    sim.catalog.addSpell({
      ...instant,
      id: 'leech',
      rangeYd: 30,
      target: 'unit',
      effects: [
        { type: 'damage', school: 'shadow', min: 100, max: 100 },
        { type: 'on_caster', effects: [{ type: 'apply_aura', aura: 'mark' }] },
      ],
    });
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'boss', 'leech', 'p1', []));
    sim.run();
    expect(sim.unit('boss').auras.has('mark|boss')).toBe(true);
    expect(sim.trace.list().filter((e) => e.kind === 'spell_hit').map((e) => e.data.target)).toEqual(['p1', 'boss']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/spell-pipeline.test.ts`
Expected: FAIL — `addSpell` and the effect code do not know `on_caster` and `script`, and `onEffectHitTarget` is never called (the first test sees `p1` take 1000, the second gets no hook calls).

- [ ] **Step 3: Extend `packages/engine/src/catalog.ts`.**

Replace
```ts
  | { readonly type: 'taunt'; readonly durationMs: number };

/**
 * Effects on every unit in an area
```
with
```ts
  | { readonly type: 'taunt'; readonly durationMs: number }
  /** SCRIPT_EFFECT / DUMMY: no default handler; a spell script's onEffectHitTarget gives it meaning. */
  | { readonly type: 'script' };

/**
 * Effects on every unit in an area
```

Replace
```ts
export type Effect = LeafEffect | AreaEffect;
```
with
```ts
/** Effects on the caster of the spell (implicit target TARGET_UNIT_CASTER) whatever the explicit target is. */
export interface OnCasterEffect {
  readonly type: 'on_caster';
  readonly effects: readonly LeafEffect[];
}

export type Effect = LeafEffect | AreaEffect | OnCasterEffect;
```

Replace
```ts
export interface SpellScript {
  /** Runs after all effects of the spell were applied to the target (A-024); skipped if the target died. */
  afterHitTarget?(ctx: SpellHitContext): void;
}
```
with
```ts
export interface EffectHitContext extends SpellHitContext {
  /** Index of the spell effect (its position in SpellDef.effects) that reached this unit. */
  readonly effectIndex: number;
}

export interface SpellScript {
  /** OnEffectHitTarget: once per unit and effect, before the effect's default handler and before the damage is dealt (A-024). */
  onEffectHitTarget?(ctx: EffectHitContext): void;
  /** Runs after everything of the spell reached the unit, for every unit hit (A-024); skipped if the unit died. */
  afterHitTarget?(ctx: SpellHitContext): void;
}
```

In `checkEffects` replace
```ts
      checkEffects(owner, e.effects);
    }
```
with
```ts
      checkEffects(owner, e.effects);
    }
    if (e.type === 'on_caster') checkEffects(owner, e.effects);
```

- [ ] **Step 4: Replace `packages/engine/src/effects.ts` with** (adds `rollDamage`, `on_caster` and `script`):

```ts
import { areaCenter, areaTargets } from './area';
import { applyAura, removeAuras } from './auras';
import type { DamageEffect, Effect, LeafEffect } from './catalog';
import { damageMultiplier, type DamageRoute } from './modifiers';
import type { Simulation } from './sim';
import { threatFor } from './threat';

export interface EffectContext {
  readonly casterId: string;
  readonly targetId: string;
  readonly ability: string;
  readonly causes: readonly string[];
  /** The effect reaches the target through an area: area modifiers apply (A-026). */
  readonly viaArea?: boolean;
}

/** Effects outside a spell launch: aura ticks and on-expire effects (spells resolve through launchSpell). */
export function applyEffects(sim: Simulation, effects: readonly Effect[], ctx: EffectContext): void {
  for (const e of effects) applyEffect(sim, e, ctx);
}

function applyEffect(sim: Simulation, e: Effect, ctx: EffectContext): void {
  switch (e.type) {
    case 'area': {
      const hit = areaTargets(sim, sim.unit(ctx.casterId), e, areaCenter(sim, e, ctx.casterId, ctx.targetId));
      for (const u of hit) applyEffects(sim, e.effects, { ...ctx, targetId: u.id, viaArea: true });
      return;
    }
    case 'on_caster':
      applyEffects(sim, e.effects, { ...ctx, targetId: ctx.casterId });
      return;
    default:
      applyLeafEffect(sim, e, ctx);
  }
}

/** Rolls a damage effect and applies the modifiers in effect now; the result is rounded when it is dealt (A-017). */
export function rollDamage(sim: Simulation, casterId: string, targetId: string, e: DamageEffect, route: DamageRoute = {}): number {
  const rolled = sim.rng.stream(`unit:${casterId}.amount`).int(e.min, e.max);
  return rolled * damageMultiplier(sim, casterId, targetId, e.school, route);
}

/** One effect on one unit. */
export function applyLeafEffect(sim: Simulation, e: LeafEffect, ctx: EffectContext): void {
  const target = sim.unit(ctx.targetId);
  switch (e.type) {
    case 'damage': {
      if (!target.alive) return;
      const amount = rollDamage(sim, ctx.casterId, target.id, e, { viaArea: ctx.viaArea === true });
      sim.damage(target.id, amount, { sourceId: ctx.casterId, ability: ctx.ability, school: e.school }, ctx.causes);
      return;
    }
    case 'heal': {
      if (!target.alive) return;
      const amount = sim.rng.stream(`unit:${ctx.casterId}.amount`).int(e.min, e.max);
      sim.heal(target.id, amount, { sourceId: ctx.casterId, ability: ctx.ability, school: 'holy' }, ctx.causes);
      return;
    }
    case 'apply_aura':
      applyAura(sim, e.aura, ctx.casterId, target.id, ctx.causes, { viaArea: ctx.viaArea === true });
      return;
    case 'remove_aura':
      removeAuras(sim, target.id, e.aura, 'removed', ctx.causes);
      return;
    case 'taunt':
      threatFor(sim)?.taunt(target.id, ctx.casterId, e.durationMs, ctx.causes);
      return;
    case 'script':
      return;
  }
}
```

- [ ] **Step 5: Write `packages/engine/src/launch.ts`:**

```ts
import { areaCenter, areaTargets } from './area';
import { applyAura } from './auras';
import type { LeafEffect, SpellDef } from './catalog';
import { applyLeafEffect, rollDamage } from './effects';
import { positionAt, travelTimeMs } from './movement';
import { EventClass } from './queue';
import type { Simulation } from './sim';

/** One effect of a spell on one unit. */
interface Item {
  readonly index: number;
  readonly effect: LeafEffect;
  readonly viaArea: boolean;
  /** Damage fixed at launch (damage effects only). */
  amount: number;
}

/**
 * Resolves a successful cast like Spell::_cast (Spell.cpp 4031–4177, research §6, A-024): every effect selects its units;
 * then, per unit in order of first appearance and per effect in effect order, damage is fixed with the modifiers in
 * effect now (DoAllEffectOnLaunchTarget, Spell.cpp 8650–8745); then every unit is hit, when the spell reaches its
 * explicit target.
 */
export function launchSpell(sim: Simulation, casterId: string, spell: SpellDef, targetId: string, cause: string): void {
  const caster = sim.unit(casterId);
  const deliveries = new Map<string, Item[]>();
  const add = (unitId: string, index: number, effect: LeafEffect, viaArea: boolean): void => {
    let items = deliveries.get(unitId);
    if (!items) deliveries.set(unitId, (items = []));
    items.push({ index, effect, viaArea, amount: 0 });
  };
  spell.effects.forEach((e, index) => {
    if (e.type === 'area') {
      for (const u of areaTargets(sim, caster, e, areaCenter(sim, e, casterId, targetId))) {
        for (const leaf of e.effects) add(u.id, index, leaf, true);
      }
    } else if (e.type === 'on_caster') {
      for (const leaf of e.effects) add(casterId, index, leaf, false);
    } else {
      add(targetId, index, e, false);
    }
  });
  for (const [unitId, items] of deliveries) {
    for (const it of items) {
      if (it.effect.type === 'damage') it.amount = rollDamage(sim, casterId, unitId, it.effect, { viaArea: it.viaArea });
    }
  }
  const deliver = (): void => {
    for (const [unitId, items] of deliveries) hitUnit(sim, casterId, spell, unitId, items, cause);
  };
  if (spell.travelSpeedYdPerSec && targetId !== casterId) {
    const delay = travelTimeMs(positionAt(caster, sim.now), positionAt(sim.unit(targetId), sim.now), spell.travelSpeedYdPerSec);
    sim.at(sim.now + delay, EventClass.SpellHit, deliver);
  } else {
    deliver();
  }
}

/** DoSpellHitOnUnit and the damage after it (Spell.cpp 3253, 3336–3354, 5866–5871, 2885–2957). */
function hitUnit(sim: Simulation, casterId: string, spell: SpellDef, unitId: string, items: readonly Item[], cause: string): void {
  const unit = sim.unit(unitId);
  if (!unit.alive || sim.over) return;
  const hitId = sim.emit('spell_hit', { caster: casterId, spell: spell.id, target: unitId }, [cause]);
  const causes = [hitId];
  const script = sim.catalog.spellScript(spell.id);
  // The spell's auras first.
  for (const it of items) {
    if (it.effect.type === 'apply_aura') applyAura(sim, it.effect.aura, casterId, unitId, causes, { viaArea: it.viaArea });
  }
  // Then per effect: the OnEffectHitTarget hook, then the effect's default handler.
  for (const index of [...new Set(items.map((it) => it.index))]) {
    if (!unit.alive) return;
    script?.onEffectHitTarget?.({ sim, spellId: spell.id, casterId, targetId: unitId, effectIndex: index, causes });
    for (const it of items) {
      if (it.index !== index || it.effect.type === 'apply_aura' || it.effect.type === 'damage') continue;
      applyLeafEffect(sim, it.effect, { casterId, targetId: unitId, ability: spell.id, causes, viaArea: it.viaArea });
    }
  }
  // The damage fixed at launch is dealt last.
  for (const it of items) {
    if (it.effect.type === 'damage') sim.damage(unitId, it.amount, { sourceId: casterId, ability: spell.id, school: it.effect.school }, causes);
  }
  if (!unit.alive) return;
  script?.afterHitTarget?.({ sim, spellId: spell.id, casterId, targetId: unitId, causes });
}
```

- [ ] **Step 6: Replace `packages/engine/src/casting.ts` with** (completion hands over to `launchSpell`; `hit` is gone; cast options reach `complete`):

```ts
import type { SpellDef } from './catalog';
import { launchSpell } from './launch';
import { edgeDistance } from './movement';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import type { CastState, Unit } from './units';

export type CastFailure =
  | 'unknown_spell'
  | 'dead'
  | 'casting'
  | 'gcd'
  | 'cooldown'
  | 'target_dead'
  | 'moving'
  | 'out_of_range'
  | 'fight_over';

export type CastCheck = { readonly ok: true } | { readonly ok: false; readonly reason: CastFailure };

export type CastResult =
  | { readonly ok: true; readonly event: string }
  | { readonly ok: false; readonly reason: CastFailure; readonly event: string };

const fail = (reason: CastFailure): CastCheck => ({ ok: false, reason });

function resolveTarget(spell: SpellDef, casterId: string, targetId: string): string {
  return spell.target === 'self' ? casterId : targetId;
}

export function checkCast(sim: Simulation, casterId: string, spellId: string, targetId: string): CastCheck {
  if (!sim.catalog.hasSpell(spellId)) return fail('unknown_spell');
  const spell = sim.catalog.spell(spellId);
  const caster = sim.unit(casterId);
  const target = sim.units.get(resolveTarget(spell, casterId, targetId));
  if (!caster.alive) return fail('dead');
  if (caster.cast) return fail('casting');
  if (spell.gcdMs > 0 && sim.now < caster.gcdUntilMs) return fail('gcd');
  if ((caster.cooldowns.get(spellId) ?? 0) > sim.now) return fail('cooldown');
  if (!target || !target.alive) return fail('target_dead');
  if (caster.move && spell.castTimeMs > 0 && !spell.usableWhileMoving) return fail('moving');
  if (target.id !== caster.id && edgeDistance(caster, target, sim.now) > spell.rangeYd) return fail('out_of_range');
  return { ok: true };
}

export interface CastOptions {
  /** AzerothCore CastSpell(..., triggered = true): no cast time, GCD, cooldown, casting or range checks (A-020).
   * A triggered cast still has projectile travel time, can still fail with `target_dead` while in flight, and is traced
   * with `castTimeMs: 0` and `triggered: true`. */
  readonly triggered?: boolean;
}

export function startCast(
  sim: Simulation,
  casterId: string,
  spellId: string,
  targetId: string,
  causes: readonly string[],
  options: CastOptions = {},
): CastResult {
  // No events once the outcome is decided; `event` is empty because nothing was written.
  if (sim.over) return { ok: false, reason: 'fight_over', event: '' };
  const failed = (reason: CastFailure): CastResult => {
    const event = sim.emit('cast_failed', { caster: casterId, spell: spellId, target: targetId, reason }, causes);
    return { ok: false, reason, event };
  };
  if (options.triggered) {
    if (!sim.catalog.hasSpell(spellId)) return failed('unknown_spell');
    const spell = sim.catalog.spell(spellId);
    const caster = sim.unit(casterId);
    const tId = resolveTarget(spell, casterId, targetId);
    const target = sim.units.get(tId);
    if (!caster.alive) return failed('dead');
    if (!target || !target.alive) return failed('target_dead');
    const event = sim.emit(
      'cast_start',
      { caster: casterId, spell: spellId, target: tId, castTimeMs: 0, endMs: sim.now, triggered: true },
      causes,
    );
    complete(sim, caster, spell, tId, event, options);
    return { ok: true, event };
  }
  const check = checkCast(sim, casterId, spellId, targetId);
  if (!check.ok) return failed(check.reason);
  const spell = sim.catalog.spell(spellId);
  const caster = sim.unit(casterId);
  const tId = resolveTarget(spell, casterId, targetId);
  if (spell.gcdMs > 0) caster.gcdUntilMs = sim.now + spell.gcdMs;
  if (spell.castTimeMs === 0) {
    const event = sim.emit('cast_start', { caster: casterId, spell: spellId, target: tId, castTimeMs: 0, endMs: sim.now }, causes);
    complete(sim, caster, spell, tId, event, options);
    return { ok: true, event };
  }
  const endMs = sim.now + spell.castTimeMs;
  const cast: CastState = {
    spellId,
    targetId: tId,
    startMs: sim.now,
    endMs,
    handle: sim.at(endMs, EventClass.SpellHit, () => {
      if (caster.cast !== cast) return;
      caster.cast = null;
      complete(sim, caster, spell, tId, cast.startEvent, options);
    }),
    startEvent: '',
  };
  caster.cast = cast;
  cast.startEvent = sim.emit(
    'cast_start',
    { caster: casterId, spell: spellId, target: tId, castTimeMs: spell.castTimeMs, endMs },
    causes,
  );
  return { ok: true, event: cast.startEvent };
}

function complete(sim: Simulation, caster: Unit, spell: SpellDef, targetId: string, startEvent: string, options: CastOptions): void {
  if (!caster.alive) return;
  const target = sim.unit(targetId);
  if (!target.alive) {
    sim.emit('cast_failed', { caster: caster.id, spell: spell.id, target: targetId, reason: 'target_dead' }, [startEvent]);
    return;
  }
  const triggered = options.triggered === true;
  if (!triggered && target.id !== caster.id && edgeDistance(caster, target, sim.now) > spell.rangeYd) {
    sim.emit('cast_failed', { caster: caster.id, spell: spell.id, target: targetId, reason: 'out_of_range' }, [startEvent]);
    return;
  }
  if (!triggered && spell.cooldownMs > 0) caster.cooldowns.set(spell.id, sim.now + spell.cooldownMs);
  const success = sim.emit('cast_success', { caster: caster.id, spell: spell.id, target: targetId }, [startEvent]);
  launchSpell(sim, caster.id, spell, targetId, success);
}

export function interruptCast(
  sim: Simulation,
  unitId: string,
  reason: 'moved' | 'stopped',
  causes: readonly string[],
): string | null {
  const u = sim.unit(unitId);
  if (!u.cast) return null;
  const spellId = u.cast.spellId;
  sim.cancel(u.cast.handle);
  u.cast = null;
  return sim.emit('cast_interrupted', { unit: unitId, spell: spellId, reason }, causes);
}

/** Engine-wide rules that react to events. Call once per simulation. */
export function installCoreRules(sim: Simulation): void {
  sim.subscribe((ev) => {
    if (ev.kind !== 'move_start' || typeof ev.data.unit !== 'string') return;
    const u = sim.unit(ev.data.unit);
    if (u.cast && !sim.catalog.spell(u.cast.spellId).usableWhileMoving) interruptCast(sim, u.id, 'moved', [ev.id]);
  });
}
```

In `packages/engine/src/index.ts` add after `export * from './eventmap';`:
```ts
export * from './launch';
```

- [ ] **Step 7: Rewrite A-024 in `docs/adaptations.md`.** Replace the row starting `| A-024 |` with:

```markdown
| A-024 | Spell resolution (Spell::_cast, research §6): every effect selects its units at launch; per unit (in order of first appearance: effect order, area units by id) and per effect, direct damage is fixed with the modifiers in effect then. Each unit is then hit: `spell_hit`, the spell's auras, then per effect the `onEffectHitTarget` hook before the effect's default handler, then the fixed damage, then `afterHitTarget`. A travelling spell hits all its units when it reaches the explicit target. Aura scripts run after the apply, stack or remove event. Hooks are not called when the holder/target is dead; `previousStacks` is given to aura hooks. | AzerothCore's order (HandleLaunchPhase, DoSpellHitOnUnit, HandleEffects HIT_TARGET); first-appearance order stands in for its internal target list order. | `aura-scripts.test.ts`, `spell-pipeline.test.ts` |
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm test packages/engine/test/spell-pipeline.test.ts packages/engine/test/casting.test.ts packages/engine/test/aura-scripts.test.ts packages/engine/test/boss-targeting.test.ts`
Expected: PASS (`spell-pipeline.test.ts` 5 tests; the other files unchanged).

- [ ] **Step 9: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): spell launch fixes damage, per-unit hit hooks before default handlers (A-024)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Max targets at launch from a named stream (research §10.5, adds A-027)

Gas Spore picks 3 random players of the room (`SPELLVALUE_MAX_TARGETS` from the script, `RandomResize`, Spell.cpp 1414–1419). Effects with the same targeting share one unit list (Spell.cpp 1002–1011).

**Files:**
- Create: `packages/engine/test/max-targets.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/area.ts`, `packages/engine/src/effects.ts`, `packages/engine/src/launch.ts`, `packages/engine/src/casting.ts`, `docs/adaptations.md`

**Changed behaviour:** none (new optional fields).

- [ ] **Step 1: Write the failing test** `packages/engine/test/max-targets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SpellDef } from '../src/catalog';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { byId } from '../src/units';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const PLAYERS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const room = { type: 'area' as const, radius: 100, center: 'caster' as const, relation: 'enemy' as const };
const SPORES: SpellDef = {
  id: 'spores',
  castTimeMs: 0,
  gcdMs: 0,
  cooldownMs: 0,
  rangeYd: 0,
  usableWhileMoving: true,
  target: 'self',
  effects: [{ ...room, effects: [{ type: 'apply_aura', aura: 'spore' }] }],
};

function newSim(seed = 21) {
  const sim = new Simulation({ seed, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  PLAYERS.forEach((id, i) => sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x: 5 + i, y: 0 } }));
  sim.catalog.addAura({ id: 'spore', durationMs: 12000, maxStacks: 1 });
  sim.catalog.addAura({ id: 'tag', durationMs: 12000, maxStacks: 1 });
  return sim;
}

const holders = (sim: Simulation, aura = 'spore') => PLAYERS.filter((id) => sim.unit(id).auras.has(`${aura}|boss`));

describe('max targets at launch (A-027)', () => {
  it('keeps a random subset drawn from the named stream', () => {
    const sim = newSim();
    sim.catalog.addSpell(SPORES);
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 3, targetStream: 'boss:boss.gas_spore' }));
    sim.run();
    const expected = new Simulation({ seed: 21, maxDurationMs: 1, sampleIntervalMs: 1 }).rng
      .stream('boss:boss.gas_spore')
      .pick(PLAYERS.map((id) => ({ id })), 3)
      .sort(byId)
      .map((u) => u.id);
    expect(holders(sim)).toHaveLength(3);
    expect(holders(sim)).toEqual(expected);
  });

  it('uses the area maxTargets unless the cast overrides it', () => {
    const limited: SpellDef = { ...SPORES, effects: [{ ...room, maxTargets: 2, effects: [{ type: 'apply_aura', aura: 'spore' }] }] };
    const sim = newSim();
    sim.catalog.addSpell(limited);
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true }));
    sim.run();
    expect(holders(sim)).toHaveLength(2);
    const over = newSim();
    over.catalog.addSpell(limited);
    over.at(0, EventClass.SpellHit, () => void startCast(over, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 4 }));
    over.run();
    expect(holders(over)).toHaveLength(4);
  });

  it('draws nothing when no more units qualify than the limit', () => {
    const sim = newSim();
    sim.catalog.addSpell(SPORES);
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 6 }));
    sim.run();
    expect(holders(sim)).toEqual(PLAYERS);
    expect(sim.rng.usage()['unit:boss.spores.targets']).toBeUndefined();
  });

  it('effects with the same targeting share one subset', () => {
    const sim = newSim();
    sim.catalog.addSpell({
      ...SPORES,
      effects: [
        { ...room, effects: [{ type: 'apply_aura', aura: 'spore' }] },
        { ...room, effects: [{ type: 'apply_aura', aura: 'tag' }] },
      ],
    });
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 3 }));
    sim.run();
    expect(holders(sim)).toHaveLength(3);
    expect(holders(sim, 'tag')).toEqual(holders(sim, 'spore'));
  });

  it('rejects a maxTargets that is not a positive integer', () => {
    const sim = newSim();
    sim.catalog.addSpell(SPORES);
    expect(() => startCast(sim, 'boss', 'spores', 'boss', [], { triggered: true, maxTargets: 0 })).toThrow(/invalid maxTargets 0/);
    expect(() => sim.catalog.addSpell({ ...SPORES, id: 'bad', effects: [{ ...room, maxTargets: 1.5, effects: [] }] })).toThrow(/bad: invalid maxTargets 1.5/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/max-targets.test.ts`
Expected: FAIL — all six players get the spore (no limit), and no error is thrown for `maxTargets: 0`.

- [ ] **Step 3: Add the field.** In `packages/engine/src/catalog.ts`, in `interface AreaEffect`, replace

```ts
  readonly excludeCaster?: boolean;
  readonly effects: readonly LeafEffect[];
}
```
with
```ts
  readonly excludeCaster?: boolean;
  /** MaxAffectedTargets: a random subset of this size when more units qualify (RandomResize, Spell.cpp 1414–1419). */
  readonly maxTargets?: number;
  readonly effects: readonly LeafEffect[];
}
```
and in `checkEffects` replace
```ts
      if (!Number.isFinite(e.radius) || e.radius < 0) throw new Error(`${owner}: invalid area radius ${e.radius}`);
```
with
```ts
      if (!Number.isFinite(e.radius) || e.radius < 0) throw new Error(`${owner}: invalid area radius ${e.radius}`);
      if (e.maxTargets !== undefined && (!Number.isInteger(e.maxTargets) || e.maxTargets < 1)) {
        throw new Error(`${owner}: invalid maxTargets ${e.maxTargets}`);
      }
```

- [ ] **Step 4: Add the subset helper to `packages/engine/src/area.ts`.** Replace

```ts
import type { Unit, Vec2 } from './units';
```
with
```ts
import { byId, type Unit, type Vec2 } from './units';
```
and append:
```ts

/** RandomResize: when more units qualify than `limit`, keeps a random subset drawn from `stream`; no draw otherwise (A-027). */
export function limitTargets(sim: Simulation, units: readonly Unit[], limit: number | undefined, stream: string): Unit[] {
  if (limit === undefined || units.length <= limit) return [...units];
  return sim.rng.stream(stream).pick(units, limit).sort(byId);
}
```

In `packages/engine/src/effects.ts` (areas of aura ticks and on-expire effects) replace
```ts
import { areaCenter, areaTargets } from './area';
```
with
```ts
import { areaCenter, areaTargets, limitTargets } from './area';
```
and replace
```ts
      const hit = areaTargets(sim, sim.unit(ctx.casterId), e, areaCenter(sim, e, ctx.casterId, ctx.targetId));
```
with
```ts
      const found = areaTargets(sim, sim.unit(ctx.casterId), e, areaCenter(sim, e, ctx.casterId, ctx.targetId));
      const hit = limitTargets(sim, found, e.maxTargets, `unit:${ctx.casterId}.${ctx.ability}.targets`);
```

- [ ] **Step 5: Use it at launch.** In `packages/engine/src/launch.ts` replace

```ts
import { areaCenter, areaTargets } from './area';
import { applyAura } from './auras';
import type { LeafEffect, SpellDef } from './catalog';
```
with
```ts
import { areaCenter, areaTargets, limitTargets } from './area';
import { applyAura } from './auras';
import type { AreaEffect, LeafEffect, SpellDef } from './catalog';
```
add after the imports (`import type { Simulation } from './sim';`):
```ts
import type { Unit } from './units';

export interface LaunchOptions {
  /** SPELLVALUE_MAX_TARGETS: overrides the maxTargets of every area effect of the spell. */
  readonly maxTargets?: number;
  /** Stream for the random subset; default `unit:<caster>.<spell>.targets` (A-027). */
  readonly targetStream?: string;
}
```
replace
```ts
export function launchSpell(sim: Simulation, casterId: string, spell: SpellDef, targetId: string, cause: string): void {
  const caster = sim.unit(casterId);
```
with
```ts
export function launchSpell(
  sim: Simulation,
  casterId: string,
  spell: SpellDef,
  targetId: string,
  cause: string,
  options: LaunchOptions = {},
): void {
  const caster = sim.unit(casterId);
  const lists = new Map<string, readonly Unit[]>();
  /** Effects with the same targeting share one unit list (Spell.cpp 1002–1011). */
  const areaUnits = (e: AreaEffect): readonly Unit[] => {
    const limit = options.maxTargets ?? e.maxTargets;
    const key = JSON.stringify([e.radius, e.center, e.relation, e.playersOnly === true, e.excludeCaster === true, limit ?? null]);
    let units = lists.get(key);
    if (!units) {
      const found = areaTargets(sim, caster, e, areaCenter(sim, e, casterId, targetId));
      units = limitTargets(sim, found, limit, options.targetStream ?? `unit:${casterId}.${spell.id}.targets`);
      lists.set(key, units);
    }
    return units;
  };
```
and replace
```ts
      for (const u of areaTargets(sim, caster, e, areaCenter(sim, e, casterId, targetId))) {
```
with
```ts
      for (const u of areaUnits(e)) {
```

- [ ] **Step 6: Pass the options from the cast.** In `packages/engine/src/casting.ts` replace

```ts
  readonly triggered?: boolean;
}
```
with
```ts
  readonly triggered?: boolean;
  /** SPELLVALUE_MAX_TARGETS for the spell's areas (A-027). */
  readonly maxTargets?: number;
  /** Random stream for the max-target subset; default `unit:<caster>.<spell>.targets`. */
  readonly targetStream?: string;
}
```
replace
```ts
): CastResult {
  // No events once the outcome is decided; `event` is empty because nothing was written.
```
with
```ts
): CastResult {
  if (options.maxTargets !== undefined && (!Number.isInteger(options.maxTargets) || options.maxTargets < 1)) {
    throw new Error(`invalid maxTargets ${options.maxTargets}`);
  }
  // No events once the outcome is decided; `event` is empty because nothing was written.
```
and replace
```ts
  launchSpell(sim, caster.id, spell, targetId, success);
```
with
```ts
  launchSpell(sim, caster.id, spell, targetId, success, { maxTargets: options.maxTargets, targetStream: options.targetStream });
```

- [ ] **Step 7: Add A-027 to `docs/adaptations.md`:**

```markdown
| A-027 | Max targets: when more units qualify for an area than its limit (MaxAffectedTargets, or the cast's `maxTargets` like SPELLVALUE_MAX_TARGETS), a random subset is drawn from a named stream (default `unit:<caster>.<spell>.targets`, or the cast's `targetStream`); no number is drawn otherwise. Effects of one spell with identical targeting share one unit list (Spell.cpp 1002–1011, 1414–1419). | Named streams keep selections comparable between runs (A-007). | `max-targets.test.ts` |
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/max-targets.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): max targets at launch from a named stream, shared target lists (A-027)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Player-caster area rules and ignored caster modifiers (research §10.8 and §7, adds A-028)

Gastric Explosion is cast by the tank: a player's area damage on more than 10 units is scaled by 10 / units (Spell.cpp 8730–8735), and `SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS` drops the caster's damage-done factors (SpellInfo.cpp 1655–1674; also on Blighted Spores and 69279).

**Files:**
- Create: `packages/engine/test/player-aoe.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/modifiers.ts`, `packages/engine/src/launch.ts`, `docs/adaptations.md`

**Changed behaviour:** none (players had no area spells; the new flag defaults to off).

- [ ] **Step 1: Write the failing test** `packages/engine/test/player-aoe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import type { SpellDef } from '../src/catalog';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const blast = (id: string, relation: 'ally' | 'enemy', extra: Partial<SpellDef> = {}): SpellDef => ({
  id,
  castTimeMs: 0,
  gcdMs: 0,
  cooldownMs: 0,
  rangeYd: 0,
  usableWhileMoving: true,
  target: 'self',
  effects: [{ type: 'area', radius: 50, center: 'caster', relation, effects: [{ type: 'damage', school: 'shadow', min: 1200, max: 1200 }] }],
  ...extra,
});

function newSim(players: number) {
  const sim = new Simulation({ seed: 3, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  for (let i = 1; i <= players; i++) {
    const id = `p${String(i).padStart(2, '0')}`;
    sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x: 10 + i * 0.1, y: 0 } });
  }
  sim.catalog.addSpell(blast('explosion', 'ally'));
  sim.catalog.addSpell(blast('pulse', 'enemy'));
  return sim;
}

const amounts = (sim: Simulation) => [...new Set(sim.trace.list().filter((e) => e.kind === 'damage').map((e) => e.data.amount))];

describe('player-caster area rules (A-028)', () => {
  it('scales a player area hit on more than 10 units by 10 / units', () => {
    const twelve = newSim(12);
    twelve.at(0, EventClass.SpellHit, () => void startCast(twelve, 'p01', 'explosion', 'p01', [], { triggered: true }));
    twelve.run();
    expect(twelve.trace.list().filter((e) => e.kind === 'damage')).toHaveLength(12);
    expect(amounts(twelve)).toEqual([1000]);
    const ten = newSim(10);
    ten.at(0, EventClass.SpellHit, () => void startCast(ten, 'p01', 'explosion', 'p01', [], { triggered: true }));
    ten.run();
    expect(amounts(ten)).toEqual([1200]);
  });

  it('does not scale a creature area hit', () => {
    const sim = newSim(12);
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'pulse', 'boss', [], { triggered: true }));
    sim.run();
    expect(amounts(sim)).toEqual([1200]);
  });

  it('ignores the caster damage-done modifiers when the spell says so, but keeps the target ones', () => {
    const sim = newSim(2);
    sim.catalog.addAura({ id: 'bloat', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_done_pct', pct: 100, perStack: false }] });
    sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false }] });
    sim.catalog.addSpell(blast('pure', 'ally', { ignoreCasterDamageMods: true }));
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'bloat', 'p01', 'p01', []);
      applyAura(sim, 'ward', 'p02', 'p02', []);
      startCast(sim, 'p01', 'pure', 'p01', [], { triggered: true });
      startCast(sim, 'p01', 'explosion', 'p01', [], { triggered: true });
    });
    sim.run();
    const toP02 = sim.trace.list().filter((e) => e.kind === 'damage' && e.data.target === 'p02').map((e) => [e.data.ability, e.data.amount]);
    expect(toP02).toEqual([['pure', 600], ['explosion', 1200]]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/player-aoe.test.ts`
Expected: FAIL — the twelve-unit explosion deals 1200, and `pure` deals 1200 to `p02`.

- [ ] **Step 3: Add the spell flag.** In `packages/engine/src/catalog.ts`, in `interface SpellDef`, replace

```ts
  readonly travelSpeedYdPerSec?: number;
  readonly effects: readonly Effect[];
}
```
with
```ts
  readonly travelSpeedYdPerSec?: number;
  /** SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS: the caster's damage-done modifiers do not apply (SpellInfo.cpp 1655–1674). */
  readonly ignoreCasterDamageMods?: boolean;
  readonly effects: readonly Effect[];
}
```

- [ ] **Step 4: Let a route skip the caster's factors.** In `packages/engine/src/modifiers.ts` replace

```ts
  readonly viaArea?: boolean;
}
```
with
```ts
  readonly viaArea?: boolean;
  /** Skip the source's damage-done factors (SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS). */
  readonly ignoreCasterMods?: boolean;
}
```
and replace
```ts
  return Math.max(0, damageDoneFactor(sim, sourceId, school) * damageTakenFactor(sim, targetId, school) * aoe);
```
with
```ts
  const done = route.ignoreCasterMods ? 1 : damageDoneFactor(sim, sourceId, school);
  return Math.max(0, done * damageTakenFactor(sim, targetId, school) * aoe);
```

- [ ] **Step 5: Apply both rules at launch.** In `packages/engine/src/launch.ts` add after the `LaunchOptions` interface:

```ts

/** Spell.cpp 8730–8735: a player's area damage on more units than this is scaled by cap / units (A-028). */
export const PLAYER_AOE_TARGET_CAP = 10;
```
and replace
```ts
  for (const [unitId, items] of deliveries) {
    for (const it of items) {
      if (it.effect.type === 'damage') it.amount = rollDamage(sim, casterId, unitId, it.effect, { viaArea: it.viaArea });
    }
  }
```
with
```ts
  // The cap counts every unit the spell hits (m_UniqueTargetInfo).
  const capped = caster.kind === 'player' && deliveries.size > PLAYER_AOE_TARGET_CAP;
  const route = { ignoreCasterMods: spell.ignoreCasterDamageMods === true };
  for (const [unitId, items] of deliveries) {
    for (const it of items) {
      if (it.effect.type !== 'damage') continue;
      const scale = capped && it.viaArea ? PLAYER_AOE_TARGET_CAP / deliveries.size : 1;
      it.amount = rollDamage(sim, casterId, unitId, it.effect, { ...route, viaArea: it.viaArea }) * scale;
    }
  }
```

- [ ] **Step 6: Add A-028 to `docs/adaptations.md`:**

```markdown
| A-028 | A player's area damage is scaled by 10 / units when the spell hits more than 10 units (Spell.cpp 8730–8735). Spells never crit: creature spells cannot (Unit.cpp 8896–8897); player-cast spells could (Gastric Explosion), which is not modelled until Plan 3 adds crit streams. `ignoreCasterDamageMods` (SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS) drops the caster's damage-done factors (SpellInfo.cpp 1655–1674). | Crit chances belong to the class models. | `player-aoe.test.ts` |
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/player-aoe.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): player area damage cap and ignored caster damage modifiers (A-028)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Periodic amounts fixed at application, scaled by stacks (research §0 and §7, adds A-029)

`AuraEffect::CalculateAmount` (SpellAuraEffects.cpp 557–580) rolls a periodic amount once, applies the caster's done bonus, and ends with `amount *= stackAmount`; damage-taken and area factors apply at each tick (SpellAuraEffects.cpp 6398–6405).

**Files:**
- Create: `packages/engine/test/periodic-amounts.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/auras.ts`, `packages/engine/src/units.ts`, `docs/adaptations.md`
- Test changes: `packages/engine/test/sim.test.ts` (hand-built aura instance gets the new field)

**Changed behaviour:** periodic damage and heal amounts were rolled at every tick with all modifiers then; now they are rolled once per (re)application with the caster's done factors and multiplied by the stacks. Every existing periodic test uses `min === max` and one stack without done modifiers, so their numbers stay; only the number of draws on `unit:<caster>.amount` changes, and no existing test or trace depends on it. New: A-029.

- [ ] **Step 1: Write the failing test** `packages/engine/test/periodic-amounts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import type { AuraDef } from '../src/catalog';
import { applyEffects } from '../src/effects';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 1000000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim(maxDurationMs = 6000) {
  const sim = new Simulation({ seed: 8, maxDurationMs, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.catalog.addAura({ id: 'fury', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_done_pct', pct: 100, perStack: false }] });
  sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false }] });
  return sim;
}

const dot = (id: string, min: number, max: number, extra: Partial<AuraDef> = {}): AuraDef => ({
  id,
  durationMs: 3000,
  maxStacks: 3,
  periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'shadow', min, max }] },
  ...extra,
});

const ticks = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'damage').map((e) => [e.t, e.data.amount]);

describe('periodic amounts (A-029)', () => {
  it('rolls the amount once per application', () => {
    const sim = newSim();
    sim.catalog.addAura(dot('rot', 100, 200));
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'rot', 'boss', 'p1', []));
    sim.run();
    const amounts = ticks(sim).map(([, a]) => a as number);
    expect(amounts).toHaveLength(3);
    expect(new Set(amounts).size).toBe(1);
    expect(amounts[0]).toBeGreaterThanOrEqual(100);
    expect(amounts[0]).toBeLessThanOrEqual(200);
  });

  it('multiplies the amount by the stacks', () => {
    const sim = newSim();
    sim.catalog.addAura(dot('rot', 100, 100));
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'rot', 'boss', 'p1', []);
      applyAura(sim, 'rot', 'boss', 'p1', []);
    });
    sim.run();
    expect(ticks(sim)).toEqual([[1000, 200], [2000, 200], [3000, 200]]);
  });

  it('takes the caster done factors at application and the target factors at each tick', () => {
    const sim = newSim(3000);
    sim.catalog.addAura(dot('rot', 100, 100));
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'rot', 'boss', 'p1', []));
    sim.at(1500, EventClass.SpellHit, () => {
      applyAura(sim, 'fury', 'boss', 'boss', []);
      applyAura(sim, 'ward', 'p1', 'p1', []);
    });
    sim.at(2500, EventClass.SpellHit, () => void applyAura(sim, 'rot', 'boss', 'p1', []));
    sim.run();
    // 3000: 100 × 2 (fury, taken at the re-application) × 2 stacks × 0.5 (ward at the tick).
    expect(ticks(sim)).toEqual([[1000, 100], [2000, 50], [3000, 200]]);
  });

  it('applies area damage avoidance at each tick of an aura an area applied', () => {
    const sim = newSim();
    sim.catalog.addAura(dot('rot', 100, 100));
    sim.catalog.addAura({ id: 'inoculated', durationMs: null, maxStacks: 3, stackScope: 'unit', modifiers: [{ kind: 'aoe_damage_taken_pct', pct: -25, perStack: true, schools: ['shadow'] }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'inoculated', 'p1', 'p1', []);
      applyAura(sim, 'inoculated', 'p1', 'p1', []);
      applyEffects(sim, [{ type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'apply_aura', aura: 'rot' }] }], { casterId: 'boss', targetId: 'boss', ability: 'cloud', causes: [] });
    });
    sim.run();
    expect(ticks(sim)).toEqual([[1000, 50], [2000, 50], [3000, 50]]);
  });

  it('ignores the caster done factors for an aura that says so', () => {
    const sim = newSim();
    sim.catalog.addAura(dot('spores', 100, 100, { ignoreCasterDamageMods: true }));
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'fury', 'boss', 'boss', []);
      applyAura(sim, 'spores', 'boss', 'p1', []);
    });
    sim.run();
    expect(ticks(sim)).toEqual([[1000, 100], [2000, 100], [3000, 100]]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/periodic-amounts.test.ts`
Expected: FAIL — the first test sees different amounts per tick, the second sees 100 per tick, the third sees 200 at 2000.

- [ ] **Step 3: Add the aura flag.** In `packages/engine/src/catalog.ts`, in `interface AuraDef`, replace

```ts
  readonly modifiers?: readonly DamageModifier[];
}
```
with
```ts
  readonly modifiers?: readonly DamageModifier[];
  /** SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS for periodic damage: the caster's done factors are not taken (A-029). */
  readonly ignoreCasterDamageMods?: boolean;
}
```

- [ ] **Step 4: Store the fixed amounts.** In `packages/engine/src/units.ts`, in `interface AuraInstance`, replace

```ts
  readonly viaArea: boolean;
}
```
with
```ts
  readonly viaArea: boolean;
  /** Per periodic effect: the amount fixed at the last (re)application, or null for effects that are not damage or heal. */
  periodicAmounts: (number | null)[];
}
```

In `packages/engine/test/sim.test.ts` replace
```ts
        viaArea: false,
      });
```
with
```ts
        viaArea: false,
        periodicAmounts: [],
      });
```

- [ ] **Step 5: Fix and use the amounts in `packages/engine/src/auras.ts`.**

Replace
```ts
import { applyEffects } from './effects';
```
with
```ts
import { applyEffects } from './effects';
import { aoeDamageFactor, damageDoneFactor, damageTakenFactor } from './modifiers';
```

Replace
```ts
    existing.refreshedMs = sim.now;
```
with
```ts
    existing.refreshedMs = sim.now;
    fixPeriodicAmounts(sim, existing);
```

Replace
```ts
    viaArea: options.viaArea === true,
  };
  inst.expiry = schedule(inst);
```
with
```ts
    viaArea: options.viaArea === true,
    periodicAmounts: [],
  };
  inst.expiry = schedule(inst);
  fixPeriodicAmounts(sim, inst);
```

Replace
```ts
    applyEffects(sim, periodic.effects, { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [tickId], viaArea: inst.viaArea });
```
with
```ts
    tickEffects(sim, inst, targetId, tickId);
```

Insert before `function scheduleTick(`:
```ts
/**
 * AuraEffect::CalculateAmount (SpellAuraEffects.cpp 557–580): a periodic damage or heal amount is rolled once, takes the
 * caster's damage-done factors and is multiplied by the stacks; recalculated whenever the aura is (re)applied (A-029).
 */
function fixPeriodicAmounts(sim: Simulation, inst: AuraInstance): void {
  const def = sim.catalog.aura(inst.auraId);
  inst.periodicAmounts = (def.periodic?.effects ?? []).map((e) => {
    if (e.type !== 'damage' && e.type !== 'heal') return null;
    const rolled = sim.rng.stream(`unit:${inst.casterId}.amount`).int(e.min, e.max);
    if (e.type === 'heal') return rolled * inst.stacks;
    const done = def.ignoreCasterDamageMods ? 1 : damageDoneFactor(sim, inst.casterId, e.school);
    return rolled * done * inst.stacks;
  });
}

/** One tick: fixed amounts take the target's factors now (and area factors for an area-applied aura); other effects run as usual. */
function tickEffects(sim: Simulation, inst: AuraInstance, targetId: string, tickId: string): void {
  const effects = sim.catalog.aura(inst.auraId).periodic?.effects ?? [];
  const ctx = { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [tickId], viaArea: inst.viaArea };
  effects.forEach((e, i) => {
    const fixed = inst.periodicAmounts[i] ?? null;
    if (fixed === null) {
      applyEffects(sim, [e], ctx);
    } else if (e.type === 'damage') {
      const aoe = inst.viaArea ? aoeDamageFactor(sim, inst.casterId, targetId, e.school) : 1;
      const amount = fixed * Math.max(0, damageTakenFactor(sim, targetId, e.school) * aoe);
      sim.damage(targetId, amount, { sourceId: inst.casterId, ability: inst.auraId, school: e.school }, [tickId]);
    } else if (e.type === 'heal') {
      sim.heal(targetId, fixed, { sourceId: inst.casterId, ability: inst.auraId, school: 'holy' }, [tickId]);
    }
  });
}

```

- [ ] **Step 6: Add A-029 to `docs/adaptations.md`:**

```markdown
| A-029 | Periodic damage and healing amounts are rolled once and multiplied by the caster's damage-done factors and by the stack count whenever the aura is applied, stacked or refreshed (AuraEffect::CalculateAmount, SpellAuraEffects.cpp 557–580); damage-taken and area factors apply at each tick (6398–6405). Recalculating on a refresh without a stack change is an assumption. | AzerothCore computes aura amounts at application. | `periodic-amounts.test.ts` |
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test packages/engine/test/periodic-amounts.test.ts packages/engine/test/auras.test.ts packages/engine/test/aura-scripts.test.ts packages/engine/test/sim.test.ts`
Expected: PASS (`periodic-amounts.test.ts` 5 tests; the others unchanged).

- [ ] **Step 8: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): periodic amounts fixed at application and scaled by stacks (A-029)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Aura replacement scope (research §10.6 and §3, updates A-016)

Blighted Spores from different casters do not stack: a newer holder's aura replaces the older one (SpellAuras.cpp 2131–2151, 2193–2210), and the removal hook runs with the old instance's times (the 1 s rule reads them). The same caster would still stack.

**Files:**
- Create: `packages/engine/test/aura-replace.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/units.ts`, `packages/engine/src/auras.ts`, `docs/adaptations.md`

**Changed behaviour:** none for the existing scopes; aura hooks get a new field `expiresMs`. Updated: A-016.

- [ ] **Step 1: Write the failing test** `packages/engine/test/aura-replace.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 9, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', pos: { x: 0, y: 0 } });
  for (const id of ['p1', 'p2', 'p3']) sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.catalog.addAura({
    id: 'spores',
    durationMs: 6000,
    maxStacks: 5,
    stackScope: 'unit_replace',
    periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'shadow', min: 10, max: 10 }] },
  });
  return sim;
}

describe("stack scope 'unit_replace' (A-016)", () => {
  it('a different caster replaces the old instance: removed with reason replaced, then the new one is applied', () => {
    const sim = newSim();
    const removed: unknown[] = [];
    const applied: string[] = [];
    sim.catalog.addAuraScript('spores', {
      afterApply: (c) => void applied.push(c.casterId),
      afterRemove: (c) =>
        void removed.push({ reason: c.reason, caster: c.casterId, appliedMs: c.appliedMs, refreshedMs: c.refreshedMs, expiresMs: c.expiresMs, now: c.sim.now }),
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'p2', 'p1', []));
    sim.at(500, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'p3', 'p1', []));
    sim.run();
    expect(removed).toEqual([{ reason: 'replaced', caster: 'p2', appliedMs: 0, refreshedMs: 0, expiresMs: 6000, now: 500 }]);
    expect(applied).toEqual(['p2', 'p3']);
    const at500 = sim.trace.list().filter((e) => e.t === 500);
    expect(at500.map((e) => [e.kind, e.data.caster])).toEqual([['aura_removed', 'p2'], ['aura_applied', 'p3']]);
    expect([...sim.unit('p1').auras.values()].map((a) => a.casterId)).toEqual(['p3']);
  });

  it('the same caster still stacks and refreshes', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'p2', 'p1', []));
    sim.at(500, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'p2', 'p1', []));
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'aura_stack').map((e) => e.data.stacks)).toEqual([2]);
    expect(sim.trace.list().some((e) => e.kind === 'aura_removed')).toBe(false);
  });

  it('hooks report expiresMs, null for a permanent aura', () => {
    const sim = newSim();
    const seen: (number | null)[] = [];
    sim.catalog.addAura({ id: 'blight', durationMs: null, maxStacks: 1 });
    sim.catalog.addAuraScript('blight', { afterApply: (c) => void seen.push(c.expiresMs) });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'blight', 'boss', 'boss', []));
    sim.run();
    expect(seen).toEqual([null]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/aura-replace.test.ts`
Expected: FAIL — `addAura` stores the unknown scope and stacks per caster (both instances coexist, no `aura_removed`), and `expiresMs` is undefined.

- [ ] **Step 3: Extend `packages/engine/src/catalog.ts`.**

Replace
```ts
export type AuraRemoveReason = 'expired' | 'removed' | 'dispelled';
```
with
```ts
export type AuraRemoveReason = 'expired' | 'removed' | 'dispelled' | 'replaced';
```

Replace
```ts
  readonly refreshedMs: number;
  readonly causes: readonly string[];
}
```
with
```ts
  readonly refreshedMs: number;
  /** Expiry time of the instance, or null for a permanent aura. */
  readonly expiresMs: number | null;
  readonly causes: readonly string[];
}
```

Replace
```ts
  /** 'caster' (default): one instance per caster; 'unit': one instance per unit, any caster stacks it. */
  readonly stackScope?: 'caster' | 'unit';
```
with
```ts
  /**
   * 'caster' (default): one instance per caster; 'unit': one instance per unit, any caster stacks it; 'unit_replace': one
   * instance per unit, its caster stacks it and another caster's application replaces it (A-016).
   */
  readonly stackScope?: 'caster' | 'unit' | 'unit_replace';
```

In `packages/engine/src/units.ts` replace
```ts
export const auraKey = (auraId: string, casterId: string, scope: 'caster' | 'unit' = 'caster'): string =>
  scope === 'unit' ? `${auraId}|*` : `${auraId}|${casterId}`;
```
with
```ts
export const auraKey = (auraId: string, casterId: string, scope: 'caster' | 'unit' | 'unit_replace' = 'caster'): string =>
  scope === 'caster' ? `${auraId}|${casterId}` : `${auraId}|*`;
```

- [ ] **Step 4: Replace `packages/engine/src/auras.ts` with** (adds replacement, `removeInstance` shared by every removal, and `expiresMs` in hook contexts; keeps the options and periodic amounts of Tasks 3 and 7):

```ts
import { applyEffects } from './effects';
import { aoeDamageFactor, damageDoneFactor, damageTakenFactor } from './modifiers';
import { EventClass, type Scheduled } from './queue';
import type { Simulation } from './sim';
import type { AuraHookContext, AuraRemoveReason } from './catalog';
import { auraKey, compareStrings, type AuraInstance } from './units';

export interface ApplyAuraOptions {
  /** The aura comes from an area effect: its periodic damage is area damage (A-026). */
  readonly viaArea?: boolean;
}

/** Applies, stacks or replaces an aura; returns the event id, or null if the target is dead or the fight is over. */
export function applyAura(
  sim: Simulation,
  auraId: string,
  casterId: string,
  targetId: string,
  causes: readonly string[],
  options: ApplyAuraOptions = {},
): string | null {
  const def = sim.catalog.aura(auraId);
  const target = sim.unit(targetId);
  if (!target.alive || sim.over) return null;
  const key = auraKey(auraId, casterId, def.stackScope ?? 'caster');
  let existing = target.auras.get(key);
  if (existing && def.stackScope === 'unit_replace' && existing.casterId !== casterId) {
    // Area auras of different casters do not stack (SpellAuras.cpp 2131–2151, 2193–2210): the old instance goes first.
    removeInstance(sim, targetId, key, existing, 'replaced', causes);
    // A removal hook may have killed the holder, decided the fight or applied this aura itself; that result stands.
    if (!target.alive || sim.over || target.auras.has(key)) return null;
    existing = undefined;
  }
  const expiresMs = def.durationMs === null ? Number.POSITIVE_INFINITY : sim.now + def.durationMs;
  const traceExpiry = Number.isFinite(expiresMs) ? expiresMs : null;
  const schedule = (inst: AuraInstance): Scheduled | null =>
    Number.isFinite(expiresMs) ? sim.at(expiresMs, EventClass.AuraExpiry, () => expire(sim, targetId, key, inst)) : null;
  if (existing) {
    const current = existing;
    const previousStacks = current.stacks;
    current.stacks = Math.min(def.maxStacks, current.stacks + 1);
    sim.cancel(current.expiry);
    current.expiresMs = expiresMs;
    current.expiry = schedule(current);
    current.refreshedMs = sim.now;
    fixPeriodicAmounts(sim, current);
    const id = sim.emit(
      'aura_stack',
      { unit: targetId, aura: auraId, caster: casterId, stacks: current.stacks, expiresMs: traceExpiry },
      causes,
    );
    if (def.periodic && current.tick === null && target.auras.get(key) === current) {
      // Resume at the kept tick anchor (A-009). It is always after now: a chain only stops when the anchor passes the expiry.
      scheduleTick(sim, targetId, key, current);
    }
    if (target.alive) sim.catalog.auraScript(auraId)?.afterStack?.(hookContext(sim, current, targetId, [id], previousStacks));
    return id;
  }
  const inst: AuraInstance = {
    auraId,
    casterId,
    stacks: 1,
    appliedMs: sim.now,
    expiresMs,
    refreshedMs: sim.now,
    expiry: null,
    tick: null,
    nextTickMs: sim.now + (def.periodic?.intervalMs ?? 0),
    appliedEvent: '',
    viaArea: options.viaArea === true,
    periodicAmounts: [],
  };
  inst.expiry = schedule(inst);
  fixPeriodicAmounts(sim, inst);
  target.auras.set(key, inst);
  inst.appliedEvent = sim.emit('aura_applied', { unit: targetId, aura: auraId, caster: casterId, stacks: 1, expiresMs: traceExpiry }, causes);
  if (def.periodic && target.auras.get(key) === inst) scheduleTick(sim, targetId, key, inst);
  if (target.alive) sim.catalog.auraScript(auraId)?.afterApply?.(hookContext(sim, inst, targetId, [inst.appliedEvent], 0));
  return inst.appliedEvent;
}

function hookContext(
  sim: Simulation,
  inst: AuraInstance,
  unitId: string,
  causes: readonly string[],
  previousStacks: number,
): AuraHookContext {
  return {
    sim,
    unitId,
    casterId: inst.casterId,
    auraId: inst.auraId,
    stacks: inst.stacks,
    previousStacks,
    appliedMs: inst.appliedMs,
    refreshedMs: inst.refreshedMs,
    expiresMs: Number.isFinite(inst.expiresMs) ? inst.expiresMs : null,
    causes,
  };
}

function afterRemove(sim: Simulation, inst: AuraInstance, unitId: string, removedId: string, reason: AuraRemoveReason): void {
  if (!sim.unit(unitId).alive) return;
  sim.catalog.auraScript(inst.auraId)?.afterRemove?.({ ...hookContext(sim, inst, unitId, [removedId], inst.stacks), reason });
}

/** Ends one instance without its on-expire effects: cancels its timers, writes aura_removed, runs afterRemove. */
function removeInstance(
  sim: Simulation,
  targetId: string,
  key: string,
  inst: AuraInstance,
  reason: AuraRemoveReason,
  causes: readonly string[],
): string {
  const target = sim.unit(targetId);
  sim.cancel(inst.expiry);
  sim.cancel(inst.tick);
  target.auras.delete(key);
  const removed = sim.emit('aura_removed', { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason }, causes);
  afterRemove(sim, inst, targetId, removed, reason);
  return removed;
}

/**
 * AuraEffect::CalculateAmount (SpellAuraEffects.cpp 557–580): a periodic damage or heal amount is rolled once, takes the
 * caster's damage-done factors and is multiplied by the stacks; recalculated whenever the aura is (re)applied (A-029).
 */
function fixPeriodicAmounts(sim: Simulation, inst: AuraInstance): void {
  const def = sim.catalog.aura(inst.auraId);
  inst.periodicAmounts = (def.periodic?.effects ?? []).map((e) => {
    if (e.type !== 'damage' && e.type !== 'heal') return null;
    const rolled = sim.rng.stream(`unit:${inst.casterId}.amount`).int(e.min, e.max);
    if (e.type === 'heal') return rolled * inst.stacks;
    const done = def.ignoreCasterDamageMods ? 1 : damageDoneFactor(sim, inst.casterId, e.school);
    return rolled * done * inst.stacks;
  });
}

/** One tick: fixed amounts take the target's factors now (and area factors for an area-applied aura); other effects run as usual. */
function tickEffects(sim: Simulation, inst: AuraInstance, targetId: string, tickId: string): void {
  const effects = sim.catalog.aura(inst.auraId).periodic?.effects ?? [];
  const ctx = { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [tickId], viaArea: inst.viaArea };
  effects.forEach((e, i) => {
    const fixed = inst.periodicAmounts[i] ?? null;
    if (fixed === null) {
      applyEffects(sim, [e], ctx);
    } else if (e.type === 'damage') {
      const aoe = inst.viaArea ? aoeDamageFactor(sim, inst.casterId, targetId, e.school) : 1;
      const amount = fixed * Math.max(0, damageTakenFactor(sim, targetId, e.school) * aoe);
      sim.damage(targetId, amount, { sourceId: inst.casterId, ability: inst.auraId, school: e.school }, [tickId]);
    } else if (e.type === 'heal') {
      sim.heal(targetId, fixed, { sourceId: inst.casterId, ability: inst.auraId, school: 'holy' }, [tickId]);
    }
  });
}

function scheduleTick(sim: Simulation, targetId: string, key: string, inst: AuraInstance): void {
  const periodic = sim.catalog.aura(inst.auraId).periodic;
  if (!periodic) return;
  const at = inst.nextTickMs;
  if (at > inst.expiresMs) {
    inst.tick = null;
    return;
  }
  inst.tick = sim.at(at, EventClass.PeriodicTick, () => {
    inst.tick = null;
    const target = sim.unit(targetId);
    if (target.auras.get(key) !== inst) return;
    inst.nextTickMs += periodic.intervalMs;
    const tickId = sim.emit(
      'periodic_tick',
      { unit: targetId, aura: inst.auraId, caster: inst.casterId, stacks: inst.stacks },
      [inst.appliedEvent],
    );
    tickEffects(sim, inst, targetId, tickId);
    // A tick effect may have re-applied this aura, which already restarted the chain.
    if (target.auras.get(key) === inst && inst.tick === null) scheduleTick(sim, targetId, key, inst);
  });
}

function expire(sim: Simulation, targetId: string, key: string, inst: AuraInstance): void {
  const target = sim.unit(targetId);
  if (target.auras.get(key) !== inst) return;
  sim.cancel(inst.tick);
  target.auras.delete(key);
  const removed = sim.emit(
    'aura_removed',
    { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason: 'expired' },
    [inst.appliedEvent],
  );
  const onExpire = sim.catalog.aura(inst.auraId).onExpire;
  if (onExpire) applyEffects(sim, onExpire, { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [removed] });
  afterRemove(sim, inst, targetId, removed, 'expired');
}

/** Removes every instance of an aura from a unit without its on-expire effect. Returns the event ids. */
export function removeAuras(
  sim: Simulation,
  targetId: string,
  auraId: string,
  reason: 'removed' | 'dispelled',
  causes: readonly string[],
): string[] {
  const target = sim.unit(targetId);
  const ids: string[] = [];
  for (const key of [...target.auras.keys()].sort(compareStrings)) {
    // A hook of an earlier removal may already have removed this instance.
    const inst = target.auras.get(key);
    if (!inst || inst.auraId !== auraId) continue;
    ids.push(removeInstance(sim, targetId, key, inst, reason, causes));
  }
  return ids;
}
```

- [ ] **Step 5: Update A-016 in `docs/adaptations.md`.** Replace the row starting `| A-016 |` with:

```markdown
| A-016 | Auras stack per caster by default: an instance is keyed by aura and caster (`aura|caster`), so two casters' copies coexist and only the same caster's copy stacks and refreshes. Stack scope `unit` keeps one instance per unit that any caster stacks. Scope `unit_replace` keeps one instance per unit that its own caster stacks, while another caster's application removes it (reason `replaced`, afterRemove runs with the old instance's times) before the new one is applied (area auras of different casters, SpellAuras.cpp 2131–2151, 2193–2210). | One rule per scope: per-caster debuffs, shared debuffs and AzerothCore's area-aura rule. | `auras.test.ts`, `aura-scripts.test.ts`, `aura-replace.test.ts` |
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test packages/engine/test/aura-replace.test.ts packages/engine/test/auras.test.ts packages/engine/test/aura-scripts.test.ts packages/engine/test/periodic-amounts.test.ts`
Expected: PASS (`aura-replace.test.ts` 3 tests; the others unchanged).

- [ ] **Step 7: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): aura replacement scope for area auras of different casters (A-016)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Removal hooks on death, death-persistent auras, dead casters and targets (research §10.7 and §8, rewrites A-012 and A-024)

A player with Blighted Spores who dies still gains Inoculated: death removes the aura with `AURA_REMOVE_BY_DEATH`, the after-remove hooks run for every remove mode (SpellAuraEffects.cpp 755–804), and Inoculated may be cast by a dead caster on a dead target and survives death (`ALLOW_CAST_WHILE_DEAD`, `ALLOW_DEAD_TARGET`, `ALLOW_AURA_WHILE_DEAD`, SpellInfo.cpp 1262).

**Files:**
- Create: `packages/engine/test/death.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/auras.ts`, `packages/engine/src/sim.ts`, `packages/engine/src/casting.ts`, `packages/engine/src/launch.ts`, `docs/adaptations.md`
- Test changes: `packages/engine/test/aura-scripts.test.ts` (two tests)

**Changed behaviour:** `afterRemove` used to be skipped for removal by death and whenever the holder was dead; it now always runs. Updated tests in `aura-scripts.test.ts`: "afterRemove does not run when the holder was killed by the on-expire effect" becomes "afterRemove runs after the on-expire effect even when that effect killed the holder" (expects `['expired']`), and "a hook that kills the holder prevents later removal hooks …" becomes "… death removes the other instances and runs their afterRemove with reason death" (expects calls `['boss', 'p2']`). Rewritten: A-012, A-024.

- [ ] **Step 1: Write the failing test** `packages/engine/test/death.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const instant = { castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 100, usableWhileMoving: true } as const;

function newSim() {
  const sim = new Simulation({ seed: 12, maxDurationMs: 5000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.addUnit({ ...body, id: 'p2', name: 'P2', kind: 'player', role: 'ranged', pos: { x: 6, y: 0 } });
  sim.catalog.addAura({ id: 'spores', durationMs: 6000, maxStacks: 1 });
  sim.catalog.addAura({ id: 'mark', durationMs: 5000, maxStacks: 1 });
  sim.catalog.addAura({ id: 'inoculated', durationMs: 120000, maxStacks: 3, stackScope: 'unit', deathPersistent: true });
  return sim;
}

const kill = (sim: Simulation, id: string) => sim.damage(id, 1e9, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []);

describe('auras and death (A-012)', () => {
  it('death runs afterRemove with reason death, after the death event', () => {
    const sim = newSim();
    const calls: string[] = [];
    sim.catalog.addAuraScript('spores', { afterRemove: (c) => void calls.push(`${c.reason}:${c.sim.unit(c.unitId).alive}`) });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'boss', 'p1', []));
    sim.at(100, EventClass.SpellHit, () => void kill(sim, 'p1'));
    sim.run();
    expect(calls).toEqual(['death:false']);
    const at100 = sim.trace.list().filter((e) => e.t === 100).map((e) => e.kind);
    expect(at100).toEqual(['damage', 'death', 'aura_removed']);
  });

  it('a death-persistent aura stays on a dead unit', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'inoculated', 'p1', 'p1', []);
      applyAura(sim, 'mark', 'boss', 'p1', []);
    });
    sim.at(100, EventClass.SpellHit, () => void kill(sim, 'p1'));
    sim.run();
    expect([...sim.unit('p1').auras.keys()]).toEqual(['inoculated|*']);
    const last = sim.trace.build({} as never).snapshots.at(-1)!;
    expect(last.units.find((u) => u.id === 'p1')?.auras).toEqual([['inoculated', 1]]);
  });

  it('a dead unit casts a spell that allows it and gains a death-persistent aura (Inoculated after Blighted Spores)', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...instant, id: 'inoculate', target: 'self', allowDeadCaster: true, allowDeadTarget: true, effects: [{ type: 'apply_aura', aura: 'inoculated' }] });
    sim.catalog.addAuraScript('spores', {
      afterRemove: (c) => void startCast(c.sim, c.unitId, 'inoculate', c.unitId, c.causes, { triggered: true }),
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'boss', 'p1', []));
    sim.at(100, EventClass.SpellHit, () => void kill(sim, 'p1'));
    sim.run();
    expect(sim.unit('p1').alive).toBe(false);
    expect(sim.unit('p1').auras.get('inoculated|*')?.stacks).toBe(1);
    expect(sim.trace.list().find((e) => e.kind === 'cast_start')?.data).toMatchObject({ caster: 'p1', spell: 'inoculate', target: 'p1' });
  });

  it('without the flags a dead caster or target fails, and a dead unit only takes death-persistent auras', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...instant, id: 'plain', target: 'self', effects: [{ type: 'apply_aura', aura: 'inoculated' }] });
    sim.catalog.addSpell({ ...instant, id: 'zap', target: 'unit', effects: [{ type: 'damage', school: 'shadow', min: 1, max: 1 }] });
    sim.at(0, EventClass.SpellHit, () => {
      kill(sim, 'p1');
      expect(startCast(sim, 'p1', 'plain', 'p1', [], { triggered: true })).toMatchObject({ ok: false, reason: 'dead' });
      expect(startCast(sim, 'boss', 'zap', 'p1', [], { triggered: true })).toMatchObject({ ok: false, reason: 'target_dead' });
      expect(applyAura(sim, 'mark', 'boss', 'p1', [], { allowDeadTarget: true })).toBeNull();
      expect(applyAura(sim, 'inoculated', 'p1', 'p1', [])).toBeNull();
      expect(applyAura(sim, 'inoculated', 'p1', 'p1', [], { allowDeadTarget: true })).not.toBeNull();
    });
    sim.run();
  });
});
```

(`trace.build` copies the snapshots and takes the meta as given, so `{} as never` is enough for reading snapshots in a test.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/death.test.ts`
Expected: FAIL — no `afterRemove` call on death, `inoculated` is removed on death, the dead caster's cast fails with `dead`.

- [ ] **Step 3: Extend `packages/engine/src/catalog.ts`.**

Replace
```ts
export type AuraRemoveReason = 'expired' | 'removed' | 'dispelled' | 'replaced';
```
with
```ts
export type AuraRemoveReason = 'expired' | 'removed' | 'dispelled' | 'replaced' | 'death';
```

Replace
```ts
  /** Not called when the aura is removed by death (A-012), nor when the holder is dead (e.g. killed by onExpire). */
  afterRemove?(ctx: AuraHookContext & { readonly reason: AuraRemoveReason }): void;
```
with
```ts
  /** Called for every removal, including by death and on a dead holder (A-012). */
  afterRemove?(ctx: AuraHookContext & { readonly reason: AuraRemoveReason }): void;
```

In `interface AuraDef` replace
```ts
  /** SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS for periodic damage: the caster's done factors are not taken (A-029). */
  readonly ignoreCasterDamageMods?: boolean;
}
```
with
```ts
  /** SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS for periodic damage: the caster's done factors are not taken (A-029). */
  readonly ignoreCasterDamageMods?: boolean;
  /** Survives the holder's death (IsDeathPersistent, SpellInfo.cpp 1262; A-012). */
  readonly deathPersistent?: boolean;
}
```

In `interface SpellDef` replace
```ts
  readonly ignoreCasterDamageMods?: boolean;
  readonly effects: readonly Effect[];
}
```
with
```ts
  readonly ignoreCasterDamageMods?: boolean;
  /** SPELL_ATTR*_ALLOW_CAST_WHILE_DEAD: a dead unit may cast it (A-012). */
  readonly allowDeadCaster?: boolean;
  /** SPELL_ATTR*_ALLOW_DEAD_TARGET: it may target and hit a dead unit (A-012). */
  readonly allowDeadTarget?: boolean;
  readonly effects: readonly Effect[];
}
```

- [ ] **Step 4: Death removal in `packages/engine/src/auras.ts`.**

Replace
```ts
  readonly viaArea?: boolean;
}

/** Applies, stacks or replaces an aura
```
with
```ts
  readonly viaArea?: boolean;
  /** The spell allows dead targets: a death-persistent aura may land on a dead unit (A-012). */
  readonly allowDeadTarget?: boolean;
}

/** Applies, stacks or replaces an aura
```

Replace
```ts
  const target = sim.unit(targetId);
  if (!target.alive || sim.over) return null;
  const key = auraKey(auraId, casterId, def.stackScope ?? 'caster');
```
with
```ts
  const target = sim.unit(targetId);
  const deadOk = options.allowDeadTarget === true && def.deathPersistent === true;
  if ((!target.alive && !deadOk) || sim.over) return null;
  const key = auraKey(auraId, casterId, def.stackScope ?? 'caster');
```

Replace
```ts
    if (!target.alive || sim.over || target.auras.has(key)) return null;
```
with
```ts
    if ((!target.alive && !deadOk) || sim.over || target.auras.has(key)) return null;
```

Replace
```ts
function afterRemove(sim: Simulation, inst: AuraInstance, unitId: string, removedId: string, reason: AuraRemoveReason): void {
  if (!sim.unit(unitId).alive) return;
  sim.catalog.auraScript(inst.auraId)?.afterRemove?.({ ...hookContext(sim, inst, unitId, [removedId], inst.stacks), reason });
}
```
with
```ts
/** AuraEffect::HandleEffect calls the after-remove hooks for every remove mode (SpellAuraEffects.cpp 755–804, A-012). */
function afterRemove(sim: Simulation, inst: AuraInstance, unitId: string, removedId: string, reason: AuraRemoveReason): void {
  sim.catalog.auraScript(inst.auraId)?.afterRemove?.({ ...hookContext(sim, inst, unitId, [removedId], inst.stacks), reason });
}
```

Append:
```ts

/** Death removes every aura that is not death-persistent, with reason death; afterRemove hooks run (Unit.cpp 5424–5443, A-012). */
export function removeAurasOnDeath(sim: Simulation, unitId: string, deathId: string): void {
  const unit = sim.unit(unitId);
  for (const key of [...unit.auras.keys()].sort(compareStrings)) {
    const inst = unit.auras.get(key);
    if (!inst || sim.catalog.aura(inst.auraId).deathPersistent) continue;
    removeInstance(sim, unitId, key, inst, 'death', [deathId]);
  }
}
```

In `packages/engine/src/sim.ts` add the import
```ts
import { removeAurasOnDeath } from './auras';
```
and in `kill` replace
```ts
    for (const key of [...u.auras.keys()].sort(compareStrings)) {
      const a = u.auras.get(key)!;
      this.cancel(a.expiry);
      this.cancel(a.tick);
      u.auras.delete(key);
      this.emit('aura_removed', { unit: u.id, aura: a.auraId, caster: a.casterId, reason: 'death' }, [deathId]);
    }
```
with
```ts
    removeAurasOnDeath(this, u.id, deathId);
```

- [ ] **Step 5: Dead casters and targets in `packages/engine/src/casting.ts`.**

In `checkCast` replace
```ts
  if (!caster.alive) return fail('dead');
  if (caster.cast) return fail('casting');
```
with
```ts
  if (!caster.alive && !spell.allowDeadCaster) return fail('dead');
  if (caster.cast) return fail('casting');
```
and
```ts
  if (!target || !target.alive) return fail('target_dead');
  if (caster.move && spell.castTimeMs > 0 && !spell.usableWhileMoving) return fail('moving');
```
with
```ts
  if (!target || (!target.alive && !spell.allowDeadTarget)) return fail('target_dead');
  if (caster.move && spell.castTimeMs > 0 && !spell.usableWhileMoving) return fail('moving');
```

In the triggered branch of `startCast` replace
```ts
    if (!caster.alive) return failed('dead');
    if (!target || !target.alive) return failed('target_dead');
```
with
```ts
    if (!caster.alive && !spell.allowDeadCaster) return failed('dead');
    if (!target || (!target.alive && !spell.allowDeadTarget)) return failed('target_dead');
```

In `complete` replace
```ts
  if (!caster.alive) return;
  const target = sim.unit(targetId);
  if (!target.alive) {
```
with
```ts
  if (!caster.alive && !spell.allowDeadCaster) return;
  const target = sim.unit(targetId);
  if (!target.alive && !spell.allowDeadTarget) {
```

- [ ] **Step 6: Dead targets in `packages/engine/src/launch.ts` (`hitUnit`).**

Replace
```ts
  const unit = sim.unit(unitId);
  if (!unit.alive || sim.over) return;
```
with
```ts
  const unit = sim.unit(unitId);
  const deadOk = spell.allowDeadTarget === true;
  if ((!unit.alive && !deadOk) || sim.over) return;
```
replace
```ts
    if (it.effect.type === 'apply_aura') applyAura(sim, it.effect.aura, casterId, unitId, causes, { viaArea: it.viaArea });
```
with
```ts
    if (it.effect.type === 'apply_aura') applyAura(sim, it.effect.aura, casterId, unitId, causes, { viaArea: it.viaArea, allowDeadTarget: deadOk });
```
replace
```ts
    if (!unit.alive) return;
    script?.onEffectHitTarget?.(
```
with
```ts
    if (!unit.alive && !deadOk) return;
    script?.onEffectHitTarget?.(
```
and replace
```ts
  if (!unit.alive) return;
  script?.afterHitTarget?.(
```
with
```ts
  if (!unit.alive && !deadOk) return;
  script?.afterHitTarget?.(
```

- [ ] **Step 7: Update the two existing tests in `packages/engine/test/aura-scripts.test.ts`.**

Replace
```ts
  it('afterRemove does not run when the holder was killed by the on-expire effect', () => {
```
with
```ts
  it('afterRemove runs after the on-expire effect even when that effect killed the holder (A-012)', () => {
```
and in that test replace
```ts
    expect(sim.unit('p1').alive).toBe(false);
    expect(calls).toEqual([]);
```
with
```ts
    expect(sim.unit('p1').alive).toBe(false);
    expect(calls).toEqual(['expired']);
```

Replace
```ts
  it('a hook that kills the holder prevents later removal hooks (death removes the other instances silently)', () => {
    // removeAuras on an already-dead holder cannot happen: death removes auras first, without hooks.
```
with
```ts
  it('a hook that kills the holder: death removes the other instances and runs their afterRemove with reason death', () => {
    // The first removal's hook kills p1; death removes the second instance (afterRemove, reason death), so removeAuras skips it.
```
and in that test replace
```ts
    expect(sim.unit('p1').alive).toBe(false);
    expect(calls).toHaveLength(1);
```
with
```ts
    expect(sim.unit('p1').alive).toBe(false);
    expect(calls).toEqual(['boss', 'p2']);
```

- [ ] **Step 8: Rewrite A-012 and A-024 in `docs/adaptations.md`.** Replace the row starting `| A-012 |` with:

```markdown
| A-012 | Removal of an aura by death does not run its on-expire effects, but its afterRemove hooks run with reason `death`; afterRemove runs for every removal, also on a dead holder (AuraEffect::HandleEffect, SpellAuraEffects.cpp 755–804). Death-persistent auras stay on a dead unit (SpellInfo.cpp 1262). A spell may be cast by a dead caster or on a dead target only when it allows that (ALLOW_CAST_WHILE_DEAD, ALLOW_DEAD_TARGET); an aura lands on a dead unit only when it is death-persistent and the spell allows dead targets. | Blighted Spores grants Inoculated to a player who died (research §8). | `auras.test.ts`, `aura-scripts.test.ts`, `death.test.ts` |
```
and the row starting `| A-024 |` with:
```markdown
| A-024 | Spell resolution (Spell::_cast, research §6): every effect selects its units at launch; per unit (in order of first appearance: effect order, area units by id) and per effect, direct damage is fixed with the modifiers in effect then. Each unit is then hit: `spell_hit`, the spell's auras, then per effect the `onEffectHitTarget` hook before the effect's default handler, then the fixed damage, then `afterHitTarget`. A travelling spell hits all its units when it reaches the explicit target. Aura scripts run after the apply, stack or remove event. afterApply, afterStack, onEffectHitTarget and afterHitTarget are not called for a dead holder/target unless the spell allows dead targets; afterRemove always runs (A-012); `previousStacks` is given to aura hooks. | AzerothCore's order (HandleLaunchPhase, DoSpellHitOnUnit, HandleEffects HIT_TARGET); first-appearance order stands in for its internal target list order. | `aura-scripts.test.ts`, `spell-pipeline.test.ts`, `death.test.ts` |
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm test packages/engine/test/death.test.ts packages/engine/test/aura-scripts.test.ts packages/engine/test/auras.test.ts packages/engine/test/sim.test.ts`
Expected: PASS (`death.test.ts` 4 tests; `aura-scripts.test.ts` with the two updated tests).

- [ ] **Step 10: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): removal hooks on death, death-persistent auras, dead casters and targets (A-012, A-024)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Casting as another unit (research §10.8, updates A-020)

The scripts make other units cast: the spore holder casts Blighted Spores, the spore target casts Inoculated, the tank casts Gastric Explosion, the Vile Gas victim casts the splash. `startCast` already takes any caster; this task adds the boss-script entry `castAs` and records the original caster in the trace.

**Files:**
- Create: `packages/engine/test/cast-as.test.ts`
- Modify: `packages/engine/src/casting.ts`, `packages/engine/src/boss.ts`, `docs/adaptations.md`

**Changed behaviour:** none (a new optional trace field only when `originalCasterId` is given). Updated: A-020 text.

- [ ] **Step 1: Write the failing test** `packages/engine/test/cast-as.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { makeBossContext } from '../src/boss';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 14, maxDurationMs: 3000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.addUnit({ ...body, id: 'p2', name: 'P2', kind: 'player', role: 'ranged', pos: { x: 6, y: 0 } });
  sim.catalog.addSpell({
    id: 'splash',
    castTimeMs: 0,
    gcdMs: 0,
    cooldownMs: 0,
    rangeYd: 0,
    usableWhileMoving: true,
    target: 'self',
    effects: [{ type: 'area', radius: 8, center: 'caster', relation: 'ally', excludeCaster: true, effects: [{ type: 'damage', school: 'shadow', min: 100, max: 100 }] }],
  });
  return sim;
}

const starts = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'cast_start');

describe('casting as another unit (A-020)', () => {
  it('a boss script makes another unit cast; the trace names the original caster', () => {
    const sim = newSim();
    sim.at(0, EventClass.AiUpdate, () => void makeBossContext(sim, 'boss').castAs('p1', 'splash', 'p1', [], { triggered: true }));
    sim.run();
    expect(starts(sim)[0].data).toMatchObject({ caster: 'p1', target: 'p1', triggered: true, originalCaster: 'boss' });
    expect(sim.trace.list().find((e) => e.kind === 'damage')?.data).toMatchObject({ target: 'p2', source: 'p1', amount: 100 });
  });

  it('an aura hook makes the holder cast', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'spore', durationMs: 1000, maxStacks: 1 });
    sim.catalog.addAuraScript('spore', {
      afterRemove: (c) => void startCast(c.sim, c.unitId, 'splash', c.unitId, c.causes, { triggered: true, originalCasterId: c.casterId }),
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    sim.run();
    const removed = sim.trace.list().find((e) => e.kind === 'aura_removed')!;
    const start = starts(sim)[0];
    expect(start.t).toBe(1000);
    expect(start.causes).toEqual([removed.id]);
    expect(start.data).toMatchObject({ caster: 'p1', originalCaster: 'boss' });
  });

  it("a triggered cast by a player leaves the player's own cast and GCD alone", () => {
    const sim = newSim();
    sim.catalog.addSpell({ id: 'bolt', castTimeMs: 2000, gcdMs: 1500, cooldownMs: 0, rangeYd: 40, usableWhileMoving: false, target: 'unit', effects: [{ type: 'damage', school: 'fire', min: 1, max: 1 }] });
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'p1', 'bolt', 'boss', []));
    sim.at(500, EventClass.AiUpdate, () => {
      makeBossContext(sim, 'boss').castAs('p1', 'splash', 'p1', [], { triggered: true });
      expect(sim.unit('p1').cast?.spellId).toBe('bolt');
      expect(sim.unit('p1').gcdUntilMs).toBe(1500);
    });
    sim.run();
    expect(sim.trace.list().find((e) => e.kind === 'cast_success' && e.data.spell === 'bolt')?.t).toBe(2000);
  });

  it('rejects an unknown original caster', () => {
    const sim = newSim();
    expect(() => startCast(sim, 'p1', 'splash', 'p1', [], { triggered: true, originalCasterId: 'ghost' })).toThrow(/unknown unit ghost/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/cast-as.test.ts`
Expected: FAIL — `castAs` is not a function; `originalCaster` is missing from `cast_start`.

- [ ] **Step 3: Record the original caster in `packages/engine/src/casting.ts`.**

Replace
```ts
  /** Random stream for the max-target subset; default `unit:<caster>.<spell>.targets`. */
  readonly targetStream?: string;
}
```
with
```ts
  /** Random stream for the max-target subset; default `unit:<caster>.<spell>.targets`. */
  readonly targetStream?: string;
  /** The unit that made this unit cast (a boss script, an aura holder's caster); traced as `originalCaster` (A-020). */
  readonly originalCasterId?: string;
}
```

Replace
```ts
    throw new Error(`invalid maxTargets ${options.maxTargets}`);
  }
```
with
```ts
    throw new Error(`invalid maxTargets ${options.maxTargets}`);
  }
  if (options.originalCasterId !== undefined) sim.unit(options.originalCasterId);
  const origin = options.originalCasterId === undefined ? {} : { originalCaster: options.originalCasterId };
```

Replace
```ts
      { caster: casterId, spell: spellId, target: tId, castTimeMs: 0, endMs: sim.now, triggered: true },
```
with
```ts
      { caster: casterId, spell: spellId, target: tId, castTimeMs: 0, endMs: sim.now, triggered: true, ...origin },
```

Replace
```ts
    const event = sim.emit('cast_start', { caster: casterId, spell: spellId, target: tId, castTimeMs: 0, endMs: sim.now }, causes);
```
with
```ts
    const event = sim.emit('cast_start', { caster: casterId, spell: spellId, target: tId, castTimeMs: 0, endMs: sim.now, ...origin }, causes);
```

Replace
```ts
    { caster: casterId, spell: spellId, target: tId, castTimeMs: spell.castTimeMs, endMs },
```
with
```ts
    { caster: casterId, spell: spellId, target: tId, castTimeMs: spell.castTimeMs, endMs, ...origin },
```

- [ ] **Step 4: Add `castAs` to `packages/engine/src/boss.ts`.**

In `interface BossContext` replace
```ts
  cast(spellId: string, targetId: string, causes: readonly string[], options?: CastOptions): CastResult;
```
with
```ts
  cast(spellId: string, targetId: string, causes: readonly string[], options?: CastOptions): CastResult;
  /** Makes another unit cast (`unit->CastSpell(...)` in a script); traced with this boss as the original caster (A-020). */
  castAs(casterId: string, spellId: string, targetId: string, causes: readonly string[], options?: CastOptions): CastResult;
```

In `makeBossContext` replace
```ts
    cast: (spellId, targetId, causes, options) => startCast(sim, bossId, spellId, targetId, causes, options),
```
with
```ts
    cast: (spellId, targetId, causes, options) => startCast(sim, bossId, spellId, targetId, causes, options),
    castAs: (casterId, spellId, targetId, causes, options = {}) =>
      startCast(sim, casterId, spellId, targetId, causes, { ...options, originalCasterId: options.originalCasterId ?? bossId }),
```

- [ ] **Step 5: Update A-020 in `docs/adaptations.md`.** Replace the row starting `| A-020 |` with:

```markdown
| A-020 | Triggered casts ignore cast time, GCD, cooldown, the casting state and range. Any unit can be made to cast (boss scripts via `castAs`, hooks via `startCast`, and the effects `trigger_spell`, `force_cast`, `periodic_trigger`); `cast_start` then records `originalCaster`. A dead caster or target only when the spell allows it (A-012). | Matches `CastSpell(..., true)` in the Festergut script; TriggerCastFlags per spell are not modelled separately. | `boss-targeting.test.ts`, `cast-as.test.ts` |
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/cast-as.test.ts packages/engine/test/boss-targeting.test.ts`
Expected: PASS (`cast-as.test.ts` 4 tests).

- [ ] **Step 7: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): casting as another unit from scripts and hooks (A-020)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Effect types `trigger_spell` and `force_cast` (research §10.9, adds A-030)

Inhale Blight's TRIGGER_SPELL gives Festergut Inhaled Blight, and Pungent Blight's re-applies Gaseous Blight; both run at launch (SpellEffects.cpp 808–812: `EffectTriggerSpell` acts in the launch modes, for a unit target per unit in `DoAllEffectOnLaunchTarget`). Gas Spore's FORCE_CAST makes every target cast 69279 on itself, triggered (SpellEffects.cpp 1043–1098).

**Files:**
- Create: `packages/engine/test/trigger-force.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/effects.ts`, `packages/engine/src/launch.ts`, `docs/adaptations.md`

**Changed behaviour:** none (new effect types). `checkEffects` gets a third parameter.

- [ ] **Step 1: Write the failing test** `packages/engine/test/trigger-force.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const self = { castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: true, target: 'self' } as const;

function newSim() {
  const sim = new Simulation({ seed: 16, maxDurationMs: 4000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  for (const [id, x] of [['p1', 5], ['p2', 6], ['p3', 7]] as const) sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x, y: 0 } });
  sim.catalog.addAura({ id: 'inhaled', durationMs: null, maxStacks: 3 });
  sim.catalog.addAura({ id: 'holder', durationMs: 12000, maxStacks: 1 });
  sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false }] });
  sim.catalog.addSpell({ ...self, id: 'inhaled_blight', effects: [{ type: 'apply_aura', aura: 'inhaled' }] });
  return sim;
}

describe('trigger_spell and force_cast (A-030)', () => {
  it('trigger_spell casts at launch, triggered, before the spell hits', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...self, id: 'inhale', castTimeMs: 3500, effects: [{ type: 'script' }, { type: 'trigger_spell', spell: 'inhaled_blight', on: 'caster' }] });
    sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'inhale', 'boss', []));
    sim.run();
    const at = sim.trace.list().filter((e) => e.t === 3500).map((e) => `${e.kind}:${e.data.spell ?? e.data.aura}`);
    expect(at).toEqual([
      'cast_success:inhale',
      'cast_start:inhaled_blight',
      'cast_success:inhaled_blight',
      'spell_hit:inhaled_blight',
      'aura_applied:inhaled',
      'spell_hit:inhale',
    ]);
    expect(sim.trace.list().find((e) => e.kind === 'cast_start' && e.data.spell === 'inhaled_blight')?.data).toMatchObject({ triggered: true, originalCaster: 'boss' });
  });

  it('damage of earlier units is fixed before a later trigger, and dealt after it', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...self, id: 'warding', effects: [{ type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'apply_aura', aura: 'ward' }] }] });
    sim.catalog.addSpell({
      ...self,
      id: 'pungent',
      effects: [
        { type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'damage', school: 'shadow', min: 1000, max: 1000 }] },
        { type: 'trigger_spell', spell: 'warding', on: 'caster' },
      ],
    });
    sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'pungent', 'boss', []));
    sim.run();
    const list = sim.trace.list();
    expect(list.filter((e) => e.kind === 'damage').map((e) => e.data.amount)).toEqual([1000, 1000, 1000]);
    const lastWard = list.map((e) => e.kind === 'aura_applied' && e.data.aura === 'ward').lastIndexOf(true);
    const firstDamage = list.findIndex((e) => e.kind === 'damage');
    expect(lastWard).toBeLessThan(firstDamage);
  });

  it('force_cast makes every unit hit cast the spell on itself', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...self, id: 'spore_holder', effects: [{ type: 'apply_aura', aura: 'holder' }] });
    sim.catalog.addSpell({ ...self, id: 'gas_spore', effects: [{ type: 'area', radius: 30, center: 'caster', relation: 'enemy', effects: [{ type: 'force_cast', spell: 'spore_holder' }] }] });
    sim.at(0, EventClass.AiUpdate, () => void startCast(sim, 'boss', 'gas_spore', 'boss', [], { triggered: true }));
    sim.run();
    for (const id of ['p1', 'p2', 'p3']) expect(sim.unit(id).auras.has(`holder|${id}`), id).toBe(true);
    const forced = sim.trace.list().filter((e) => e.kind === 'cast_start' && e.data.spell === 'spore_holder');
    expect(forced.map((e) => [e.data.caster, e.data.target, e.data.originalCaster])).toEqual([
      ['p1', 'p1', 'boss'],
      ['p2', 'p2', 'boss'],
      ['p3', 'p3', 'boss'],
    ]);
  });

  it('only spells use trigger_spell', () => {
    const sim = newSim();
    expect(() =>
      sim.catalog.addAura({ id: 'bad', durationMs: 1000, maxStacks: 1, periodic: { intervalMs: 500, effects: [{ type: 'trigger_spell', spell: 'inhaled_blight', on: 'caster' }] } }),
    ).toThrow(/bad: trigger_spell is a spell effect/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/trigger-force.test.ts`
Expected: FAIL — the trigger effect is treated as a leaf effect with no handler (no `inhaled_blight` cast), `force_cast` does nothing, and `addAura` accepts `trigger_spell`.

- [ ] **Step 3: Add the types and validation in `packages/engine/src/catalog.ts`.**

Replace
```ts
  /** SCRIPT_EFFECT / DUMMY: no default handler; a spell script's onEffectHitTarget gives it meaning. */
  | { readonly type: 'script' };
```
with
```ts
  /** SCRIPT_EFFECT / DUMMY: no default handler; a spell script's onEffectHitTarget gives it meaning. */
  | { readonly type: 'script' }
  /** FORCE_CAST: the unit hit casts the spell on itself, triggered (SpellEffects.cpp 1043–1098, A-030). */
  | { readonly type: 'force_cast'; readonly spell: string };
```

Replace
```ts
export type Effect = LeafEffect | AreaEffect | OnCasterEffect;
```
with
```ts
/** TRIGGER_SPELL: at launch the caster casts the spell, triggered, at itself or the explicit target (A-030). Spells only. */
export interface TriggerSpellEffect {
  readonly type: 'trigger_spell';
  readonly spell: string;
  readonly on: 'caster' | 'target';
}

export type Effect = LeafEffect | AreaEffect | OnCasterEffect | TriggerSpellEffect;
```

Replace the whole function `checkEffects` (from `/** Validates effect definitions; later tasks add rules per effect type. */` to its closing brace) with:
```ts
/** Validates effect definitions; `where` is a spell's effects, or an aura's periodic and on-expire effects. */
function checkEffects(owner: string, effects: readonly Effect[], where: 'spell' | 'aura'): void {
  for (const e of effects) {
    if (e.type === 'damage') checkSchools(owner, e.school);
    if (e.type === 'area') {
      if (!Number.isFinite(e.radius) || e.radius < 0) throw new Error(`${owner}: invalid area radius ${e.radius}`);
      if (e.maxTargets !== undefined && (!Number.isInteger(e.maxTargets) || e.maxTargets < 1)) {
        throw new Error(`${owner}: invalid maxTargets ${e.maxTargets}`);
      }
    }
    if (e.type === 'area' || e.type === 'on_caster') checkEffects(owner, e.effects, where);
    if ((e.type === 'trigger_spell' || e.type === 'force_cast') && !ID_PATTERN.test(e.spell)) {
      throw new Error(`${owner}: invalid spell id ${e.spell}`);
    }
    if (e.type === 'trigger_spell' && where !== 'spell') {
      throw new Error(`${owner}: trigger_spell is a spell effect; auras use periodic_trigger`);
    }
  }
}
```

Replace
```ts
    checkEffects(def.id, def.effects);
```
with
```ts
    checkEffects(def.id, def.effects, 'spell');
```
and
```ts
    checkEffects(def.id, [...(def.periodic?.effects ?? []), ...(def.onExpire ?? [])]);
```
with
```ts
    checkEffects(def.id, [...(def.periodic?.effects ?? []), ...(def.onExpire ?? [])], 'aura');
```

- [ ] **Step 4: Handle `force_cast` in `packages/engine/src/effects.ts`.**

Replace
```ts
import { applyAura, removeAuras } from './auras';
```
with
```ts
import { applyAura, removeAuras } from './auras';
import { startCast } from './casting';
```

Replace
```ts
    case 'on_caster':
      applyEffects(sim, e.effects, { ...ctx, targetId: ctx.casterId });
      return;
    default:
```
with
```ts
    case 'on_caster':
      applyEffects(sim, e.effects, { ...ctx, targetId: ctx.casterId });
      return;
    case 'trigger_spell':
      throw new Error(`${ctx.ability}: trigger_spell only runs at a spell's launch`);
    default:
```

Replace
```ts
    case 'script':
      return;
  }
}
```
with
```ts
    case 'script':
      return;
    case 'force_cast':
      castOnSelf(sim, e.spell, ctx);
      return;
  }
}

/** The unit casts the spell on itself, triggered; the effect's caster is recorded as the original caster (A-030). */
function castOnSelf(sim: Simulation, spellId: string, ctx: EffectContext): void {
  startCast(sim, ctx.targetId, spellId, ctx.targetId, ctx.causes, { triggered: true, originalCasterId: ctx.casterId });
}
```

- [ ] **Step 5: Run `trigger_spell` at launch in `packages/engine/src/launch.ts`.**

Replace
```ts
import type { AreaEffect, LeafEffect, SpellDef } from './catalog';
```
with
```ts
import type { AreaEffect, LeafEffect, SpellDef, TriggerSpellEffect } from './catalog';
import { startCast } from './casting';
```

Replace
```ts
  readonly index: number;
  readonly effect: LeafEffect;
```
with
```ts
  readonly index: number;
  readonly effect: LeafEffect | TriggerSpellEffect;
```

Replace
```ts
  const add = (unitId: string, index: number, effect: LeafEffect, viaArea: boolean): void => {
```
with
```ts
  const add = (unitId: string, index: number, effect: LeafEffect | TriggerSpellEffect, viaArea: boolean): void => {
```

Replace
```ts
    } else if (e.type === 'on_caster') {
      for (const leaf of e.effects) add(casterId, index, leaf, false);
    } else {
```
with
```ts
    } else if (e.type === 'on_caster') {
      for (const leaf of e.effects) add(casterId, index, leaf, false);
    } else if (e.type === 'trigger_spell') {
      add(e.on === 'caster' ? casterId : targetId, index, e, false);
    } else {
```

Replace
```ts
    for (const it of items) {
      if (it.effect.type !== 'damage') continue;
      const scale = capped && it.viaArea ? PLAYER_AOE_TARGET_CAP / deliveries.size : 1;
      it.amount = rollDamage(sim, casterId, unitId, it.effect, { ...route, viaArea: it.viaArea }) * scale;
    }
```
with
```ts
    for (const it of items) {
      if (it.effect.type === 'trigger_spell') {
        // EffectTriggerSpell in LAUNCH_TARGET mode (SpellEffects.cpp 808–812): cast now, before any unit is hit.
        startCast(sim, casterId, it.effect.spell, unitId, [cause], { triggered: true, originalCasterId: casterId });
        continue;
      }
      if (it.effect.type !== 'damage') continue;
      const scale = capped && it.viaArea ? PLAYER_AOE_TARGET_CAP / deliveries.size : 1;
      it.amount = rollDamage(sim, casterId, unitId, it.effect, { ...route, viaArea: it.viaArea }) * scale;
    }
```

Replace
```ts
      if (it.index !== index || it.effect.type === 'apply_aura' || it.effect.type === 'damage') continue;
```
with
```ts
      if (it.index !== index || it.effect.type === 'apply_aura' || it.effect.type === 'damage' || it.effect.type === 'trigger_spell') continue;
```

- [ ] **Step 6: Add A-030 to `docs/adaptations.md`:**

```markdown
| A-030 | Effect types: `trigger_spell` makes the caster cast its spell, triggered, during launch (per unit and effect, like EffectTriggerSpell in LAUNCH_TARGET mode, SpellEffects.cpp 808–812), so it acts before any unit is hit and after the damage of earlier units was fixed; `force_cast` makes each unit hit cast its spell on itself, triggered (SpellEffects.cpp 1043–1098). Both record the spell's caster as `originalCaster`. LINKED auras are not modelled. | The triggered spells in this fight target the casting unit itself. | `trigger-force.test.ts` |
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/trigger-force.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): trigger_spell at launch and force_cast effects (A-030)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Effect types `periodic_trigger` and `instakill` (research §10.9, §3 and §7; extends A-030)

Gaseous Blight ticks and Gas Spore's single tick make the aura's holder cast a spell (SpellAuraEffects.cpp 6252: the holder casts because the triggered spell needs no explicit target). Gastric Explosion's INSTAKILL kills its caster (SpellEffects.cpp 279–292). The tick at expiry runs before the removal (already A-001; SpellAuraEffects.cpp 926–950 then Unit.cpp 3790), tested here with a single tick.

**Files:**
- Create: `packages/engine/test/periodic-trigger.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/effects.ts`, `docs/adaptations.md`

**Changed behaviour:** none (new effect types).

- [ ] **Step 1: Write the failing test** `packages/engine/test/periodic-trigger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const self = { castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: true, target: 'self' } as const;

function newSim() {
  const sim = new Simulation({ seed: 18, maxDurationMs: 13000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  for (const [id, x] of [['p1', 5], ['p2', 6], ['p3', 20], ['tank', 5.5]] as const) sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x, y: 0 } });
  sim.catalog.addAura({ id: 'blight', durationMs: 6000, maxStacks: 1 });
  sim.catalog.addSpell({ ...self, id: 'blighted_spores', effects: [{ type: 'area', radius: 8, center: 'caster', relation: 'ally', effects: [{ type: 'apply_aura', aura: 'blight' }] }] });
  sim.catalog.addAura({ id: 'spore_holder', durationMs: 12000, maxStacks: 1, periodic: { intervalMs: 12000, effects: [{ type: 'periodic_trigger', spell: 'blighted_spores' }] } });
  return sim;
}

describe('periodic_trigger and instakill (A-030)', () => {
  it('the holder casts at the tick; a single tick at expiry comes before the removal', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spore_holder', 'boss', 'p1', []));
    sim.run();
    const at = sim.trace.list().filter((e) => e.t === 12000);
    expect(at.map((e) => e.kind)).toEqual([
      'periodic_tick',
      'cast_start',
      'cast_success',
      'spell_hit',
      'aura_applied',
      'spell_hit',
      'aura_applied',
      'spell_hit',
      'aura_applied',
      'aura_removed',
    ]);
    expect(at[1].data).toMatchObject({ caster: 'p1', spell: 'blighted_spores', originalCaster: 'boss' });
    expect(at.filter((e) => e.kind === 'aura_applied').map((e) => [e.data.unit, e.data.caster])).toEqual([
      ['p1', 'p1'],
      ['p2', 'p1'],
      ['tank', 'p1'],
    ]);
  });

  it('instakill deals the remaining health as damage, without modifiers', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false }] });
    sim.catalog.addSpell({
      ...self,
      id: 'explosion',
      effects: [
        { type: 'area', radius: 10, center: 'caster', relation: 'ally', effects: [{ type: 'damage', school: ['nature', 'shadow'], min: 100, max: 100 }] },
        { type: 'on_caster', effects: [{ type: 'instakill' }] },
      ],
    });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'ward', 'tank', 'tank', []);
      startCast(sim, 'tank', 'explosion', 'tank', [], { triggered: true });
    });
    sim.run();
    const dmg = sim.trace.list().filter((e) => e.kind === 'damage').map((e) => [e.data.target, e.data.amount]);
    expect(dmg).toEqual([['p1', 100], ['p2', 100], ['tank', 100000]]);
    expect(sim.unit('tank').alive).toBe(false);
  });

  it('periodic_trigger is an aura effect', () => {
    const sim = newSim();
    expect(() => sim.catalog.addSpell({ ...self, id: 'bad', effects: [{ type: 'periodic_trigger', spell: 'blighted_spores' }] })).toThrow(
      /bad: periodic_trigger is an aura effect/,
    );
  });
});
```

(Area units are hit in id order: `p1`, `p2`, `tank`; `p3` stands 15 yd from `p1`. In the explosion the tank is processed last; its instakill comes before its own area damage, which is then not dealt.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/periodic-trigger.test.ts`
Expected: FAIL — `periodic_trigger` and `instakill` have no handlers, `addSpell` accepts `periodic_trigger`.

- [ ] **Step 3: Add the types and validation in `packages/engine/src/catalog.ts`.**

Replace
```ts
  /** FORCE_CAST: the unit hit casts the spell on itself, triggered (SpellEffects.cpp 1043–1098, A-030). */
  | { readonly type: 'force_cast'; readonly spell: string };
```
with
```ts
  /** FORCE_CAST: the unit hit casts the spell on itself, triggered (SpellEffects.cpp 1043–1098, A-030). */
  | { readonly type: 'force_cast'; readonly spell: string }
  /** PERIODIC_TRIGGER_SPELL: at each tick the aura's holder casts the spell on itself (SpellAuraEffects.cpp 6252). Auras only. */
  | { readonly type: 'periodic_trigger'; readonly spell: string }
  /** INSTAKILL: damage equal to the target's health, without modifiers (SpellEffects.cpp 279–292). */
  | { readonly type: 'instakill' };
```

In `checkEffects` replace
```ts
    if ((e.type === 'trigger_spell' || e.type === 'force_cast') && !ID_PATTERN.test(e.spell)) {
```
with
```ts
    if (e.type === 'periodic_trigger' && where !== 'aura') {
      throw new Error(`${owner}: periodic_trigger is an aura effect; spells use trigger_spell or force_cast`);
    }
    if ((e.type === 'trigger_spell' || e.type === 'force_cast' || e.type === 'periodic_trigger') && !ID_PATTERN.test(e.spell)) {
```

- [ ] **Step 4: Handle them in `packages/engine/src/effects.ts`.** Replace

```ts
    case 'force_cast':
      castOnSelf(sim, e.spell, ctx);
      return;
  }
}
```
with
```ts
    case 'force_cast':
    case 'periodic_trigger':
      castOnSelf(sim, e.spell, ctx);
      return;
    case 'instakill':
      if (!target.alive) return;
      sim.damage(target.id, target.health, { sourceId: ctx.casterId, ability: ctx.ability, school: 'physical' }, ctx.causes);
      return;
  }
}
```

- [ ] **Step 5: Extend A-030 in `docs/adaptations.md`.** Replace the row starting `| A-030 |` with:

```markdown
| A-030 | Effect types: `trigger_spell` makes the caster cast its spell, triggered, during launch (per unit and effect, like EffectTriggerSpell in LAUNCH_TARGET mode, SpellEffects.cpp 808–812), so it acts before any unit is hit and after the damage of earlier units was fixed; `force_cast` makes each unit hit cast its spell on itself, triggered (SpellEffects.cpp 1043–1098); `periodic_trigger` makes the aura's holder cast its spell on itself at each tick (SpellAuraEffects.cpp 6252); `instakill` deals damage equal to the target's health, without modifiers (SpellEffects.cpp 279–292). The casting effects record the original caster. LINKED auras are not modelled. | The triggered spells in this fight target the casting unit itself. | `trigger-force.test.ts`, `periodic-trigger.test.ts` |
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/periodic-trigger.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): periodic_trigger and instakill effects (A-030)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 13: Attack-speed auras and the swing timer (research §10.10, adds A-031)

Inhaled Blight (MOD_ATTACKSPEED +30 % per stack in 25n) and Berserk (MOD_MELEE_HASTE +150 %) shorten Festergut's swings. Read at the pinned commit, `Unit::ApplyAttackTimePercentMod` (Unit.cpp 13135–13152) multiplies the base attack time and `m_modAttackSpeedPct` by 100/(100+val) (a negative val by (100+|val|)/100), and rescales the running swing timer by the remaining fraction; `GetAttackTime` (base / mod) stays unhasted, so the damage formula's attack-time multiplier does not change.

**Files:**
- Create: `packages/engine/src/stats.ts`, `packages/engine/test/attack-speed.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/modifiers.ts`, `packages/engine/src/units.ts`, `packages/engine/src/melee.ts`, `packages/engine/src/auras.ts`, `packages/engine/src/index.ts`, `docs/adaptations.md`

**Changed behaviour:** the swing interval was `melee.attackTimeMs`; it is now `trunc(attackTimeMs × swingFactor)`, which is the same value without attack-speed auras. New: A-031.

- [ ] **Step 1: Write the failing test** `packages/engine/test/attack-speed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { EventScriptedAI, attachBoss, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { swingIntervalMs } from '../src/stats';
import { ThreatManager } from '../src/threat';

class Idle extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [];
  protected engage(_ctx: BossContext): void {}
  protected executeEvent(): void {}
}

function newSim(maxDurationMs = 3000) {
  const sim = new Simulation({ seed: 20, maxDurationMs, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, level: 83, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 8, boundingRadius: 0.31, melee: { minDamage: 10000, maxDamage: 10000, attackTimeMs: 2000 } });
  sim.addUnit({ id: 't1', name: 'T1', kind: 'player', role: 'tank', maxHealth: 1e7, pos: { x: 10, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  attachBoss(sim, new Idle(), 'boss', 10);
  threat.add('boss', 't1', 1);
  const auras = [['inhaled', 30, 3, true], ['berserk', 150, 1, false], ['haste', 100, 1, false], ['slow', -50, 1, false]] as const;
  for (const [id, pct, maxStacks, perStack] of auras) {
    sim.catalog.addAura({ id, durationMs: null, maxStacks, modifiers: [{ kind: 'attack_speed_pct', pct, perStack }] });
  }
  return sim;
}

const swings = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'damage' && e.data.ability === 'melee');

describe('attack speed (A-031)', () => {
  it('multiplies the swing interval by 100 / (100 + pct) per aura, truncated to whole ms', () => {
    const sim = newSim();
    const boss = sim.unit('boss');
    for (let i = 0; i < 3; i++) applyAura(sim, 'inhaled', 'boss', 'boss', []);
    expect(swingIntervalMs(boss)).toBe(1052);
    applyAura(sim, 'berserk', 'boss', 'boss', []);
    expect(swingIntervalMs(boss)).toBe(421);
  });

  it('a slow multiplies the interval by (100 + |pct|) / 100', () => {
    const sim = newSim();
    applyAura(sim, 'slow', 'boss', 'boss', []);
    expect(swingIntervalMs(sim.unit('boss'))).toBe(3000);
  });

  it('a new attack speed rescales the remaining swing time', () => {
    const sim = newSim();
    sim.at(1010, EventClass.SpellHit, () => void applyAura(sim, 'haste', 'boss', 'boss', []));
    sim.run();
    // Swing at 10 → next at 2010; at 1010 the remaining 1000 ms become 500 → 1510; then every 1000 ms.
    expect(swings(sim).map((e) => e.t)).toEqual([10, 1510, 2510]);
  });

  it('does not change the damage of a swing', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'haste', 'boss', 'boss', []));
    sim.run();
    expect(swings(sim).map((e) => [e.t, e.data.amount])).toEqual([[10, 10000], [1010, 10000], [2010, 10000]]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/attack-speed.test.ts`
Expected: FAIL, cannot resolve `../src/stats`.

- [ ] **Step 3: Add the stat modifier type in `packages/engine/src/catalog.ts`.**

Replace
```ts
export type AuraRemoveReason =
```
with
```ts
/** Aura effects on unit stats (stats.ts): MOD_ATTACKSPEED / MOD_MELEE_HASTE (A-031). */
export interface StatModifier {
  readonly kind: 'attack_speed_pct';
  readonly pct: number;
  readonly perStack: boolean;
}

export type AuraModifier = DamageModifier | StatModifier;

export type AuraRemoveReason =
```

In `interface AuraDef` replace
```ts
  readonly modifiers?: readonly DamageModifier[];
```
with
```ts
  readonly modifiers?: readonly AuraModifier[];
```

In `addAura` replace
```ts
      if (m.schools !== undefined) checkSchools(def.id, m.schools);
```
with
```ts
      if ('schools' in m && m.schools !== undefined) checkSchools(def.id, m.schools);
```

- [ ] **Step 4: Keep damage factors to damage modifiers in `packages/engine/src/modifiers.ts`.**

Replace
```ts
import type { DamageModifier, SchoolSet } from './catalog';
```
with
```ts
import type { AuraModifier, DamageModifier, SchoolSet } from './catalog';
```

Replace
```ts
/** A modifier applies when its schools overlap
```
with
```ts
const DAMAGE_KINDS: ReadonlySet<string> = new Set(['damage_done_pct', 'damage_taken_pct', 'aoe_damage_taken_pct', 'creature_aoe_damage_taken_pct']);

export function isDamageModifier(m: AuraModifier): m is DamageModifier {
  return DAMAGE_KINDS.has(m.kind);
}

/** A modifier applies when its schools overlap
```

Replace
```ts
      if (m.kind !== kind || !applies(m, school)) continue;
```
with
```ts
      if (!isDamageModifier(m) || m.kind !== kind || !applies(m, school)) continue;
```

- [ ] **Step 5: Add the factor to units.** In `packages/engine/src/units.ts`, in `interface Unit`, replace

```ts
  /** Earliest time of the next melee swing. */
  nextSwingMs: number;
```
with
```ts
  /** Earliest time of the next melee swing. */
  nextSwingMs: number;
  /** Product of the attack-speed factors of the unit's auras (stats.ts, A-031); 1 without such auras. */
  swingFactor: number;
```
and in `createUnit` replace
```ts
    nextSwingMs: 0,
```
with
```ts
    nextSwingMs: 0,
    swingFactor: 1,
```

- [ ] **Step 6: Write `packages/engine/src/stats.ts`:**

```ts
import type { AuraDef, StatModifier } from './catalog';
import type { Simulation } from './sim';
import { compareStrings, type Unit } from './units';

/** Amounts (pct × stacks where per stack) of the unit's stat modifiers of one kind, in aura key order. */
function statAmounts(sim: Simulation, unit: Unit, kind: StatModifier['kind']): number[] {
  const out: number[] = [];
  for (const key of [...unit.auras.keys()].sort(compareStrings)) {
    const inst = unit.auras.get(key)!;
    for (const m of sim.catalog.aura(inst.auraId).modifiers ?? []) {
      if (m.kind === kind) out.push(m.pct * (m.perStack ? inst.stacks : 1));
    }
  }
  return out;
}

/** Whether the aura changes unit stats, so applying or removing it needs refreshStats. */
export function hasStatModifiers(def: AuraDef): boolean {
  return (def.modifiers ?? []).some((m) => m.kind === 'attack_speed_pct');
}

/**
 * Unit::ApplyAttackTimePercentMod (Unit.cpp 13135–13152): each attack-speed effect multiplies the attack time by
 * 100 / (100 + pct), a slow (negative pct) by (100 - pct) / 100; several effects multiply.
 */
export function swingTimeFactor(sim: Simulation, unit: Unit): number {
  let f = 1;
  for (const pct of statAmounts(sim, unit, 'attack_speed_pct')) f *= pct > 0 ? 100 / (100 + pct) : (100 - pct) / 100;
  return f;
}

/** The swing interval: base attack time × factor, truncated to whole ms like the uint32 attack timer (A-031). */
export function swingIntervalMs(unit: Unit): number {
  if (!unit.melee) throw new Error(`unit ${unit.id} has no melee stats`);
  return Math.max(1, Math.trunc(unit.melee.attackTimeMs * unit.swingFactor));
}

/** Recomputes stats after an aura change; a new attack speed rescales the remaining swing time by new / old. */
export function refreshStats(sim: Simulation, unitId: string): void {
  const u = sim.unit(unitId);
  const f = swingTimeFactor(sim, u);
  if (f !== u.swingFactor) {
    const remaining = Math.max(0, u.nextSwingMs - sim.now);
    u.nextSwingMs = sim.now + Math.trunc((remaining * f) / u.swingFactor);
    u.swingFactor = f;
  }
}
```

- [ ] **Step 7: Use it.** In `packages/engine/src/melee.ts` replace

```ts
import { withinMeleeRange } from './movement';
```
with
```ts
import { withinMeleeRange } from './movement';
import { swingIntervalMs } from './stats';
```
and
```ts
  a.nextSwingMs = sim.now + a.melee.attackTimeMs;
```
with
```ts
  a.nextSwingMs = sim.now + swingIntervalMs(a);
```

In `packages/engine/src/auras.ts` replace
```ts
import { EventClass, type Scheduled } from './queue';
```
with
```ts
import { EventClass, type Scheduled } from './queue';
import { hasStatModifiers, refreshStats } from './stats';
```
replace
```ts
    fixPeriodicAmounts(sim, current);
```
with
```ts
    fixPeriodicAmounts(sim, current);
    if (hasStatModifiers(def)) refreshStats(sim, targetId);
```
replace
```ts
  target.auras.set(key, inst);
```
with
```ts
  target.auras.set(key, inst);
  if (hasStatModifiers(def)) refreshStats(sim, targetId);
```
in `removeInstance` replace
```ts
  target.auras.delete(key);
  const removed = sim.emit('aura_removed', { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason }, causes);
```
with
```ts
  target.auras.delete(key);
  if (hasStatModifiers(sim.catalog.aura(inst.auraId))) refreshStats(sim, targetId);
  const removed = sim.emit('aura_removed', { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason }, causes);
```
and in `expire` replace
```ts
  target.auras.delete(key);
  const removed = sim.emit(
    'aura_removed',
```
with
```ts
  target.auras.delete(key);
  if (hasStatModifiers(sim.catalog.aura(inst.auraId))) refreshStats(sim, targetId);
  const removed = sim.emit(
    'aura_removed',
```

In `packages/engine/src/index.ts` add after `export * from './standin';`:
```ts
export * from './stats';
```

- [ ] **Step 8: Add A-031 to `docs/adaptations.md`:**

```markdown
| A-031 | Attack-speed auras (MOD_ATTACKSPEED, MOD_MELEE_HASTE) multiply the swing interval by 100 / (100 + pct) each, a slow by (100 + abs(pct)) / 100; the interval is truncated to whole ms like the uint32 attack timer. A change rescales the remaining swing time by new / old (Unit::ApplyAttackTimePercentMod, Unit.cpp 13135–13152, SpellAuraEffects.cpp 4830–4858). Per-swing damage is not recomputed: the damage formula uses GetAttackTime, which stays unhasted. | AzerothCore behaviour; whole milliseconds because the event queue uses integer times. | `attack-speed.test.ts`, `melee.test.ts` |
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm test packages/engine/test/attack-speed.test.ts packages/engine/test/melee.test.ts`
Expected: PASS (`attack-speed.test.ts` 4 tests; `melee.test.ts` unchanged).

- [ ] **Step 10: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): attack-speed auras shorten and rescale the swing timer (A-031)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Scale auras and combat reach (research §10.10, adds A-032)

Inhaled Blight (+20 % scale per stack) and Berserk (+25 %) grow Festergut: MOD_SCALE amounts are summed and added to the native scale 1 (Unit.cpp 12829–12835), and a creature's combat reach is the model reach × scale (Creature.cpp 3591–3607). 25n with 3 stacks: 8 × 1.6 = 12.8 yd; with Berserk 8 × 1.85 = 14.8 yd. This moves melee range and the Vile Gas distance threshold.

**Files:**
- Create: `packages/engine/test/scale.test.ts`
- Modify: `packages/engine/src/catalog.ts`, `packages/engine/src/units.ts`, `packages/engine/src/stats.ts`, `docs/adaptations.md`

**Changed behaviour:** `Unit.combatReach` becomes mutable and is derived from the new `baseCombatReach`; equal to it without scale auras. New: A-032.

- [ ] **Step 1: Write the failing test** `packages/engine/test/scale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import { withinMeleeRange } from '../src/movement';
import { Simulation } from '../src/sim';
import { scaleOf } from '../src/stats';

const body = { maxHealth: 100000, speedYdPerSec: 7, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 22, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', combatReach: 8, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 't1', name: 'T1', kind: 'player', role: 'tank', combatReach: 1.5, pos: { x: 14, y: 0 } });
  sim.catalog.addAura({ id: 'swell', durationMs: null, maxStacks: 3, modifiers: [{ kind: 'scale_pct', pct: 20, perStack: true }] });
  sim.catalog.addAura({ id: 'berserk', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'scale_pct', pct: 25, perStack: false }] });
  return sim;
}

describe('scale (A-032)', () => {
  it('adds scale amounts to the native scale 1 and scales the combat reach', () => {
    const sim = newSim();
    const boss = sim.unit('boss');
    for (let i = 0; i < 3; i++) applyAura(sim, 'swell', 'boss', 'boss', []);
    expect(scaleOf(sim, boss)).toBeCloseTo(1.6, 10);
    expect(boss.combatReach).toBeCloseTo(12.8, 10);
    applyAura(sim, 'berserk', 'boss', 'boss', []);
    expect(scaleOf(sim, boss)).toBeCloseTo(1.85, 10);
    expect(boss.combatReach).toBeCloseTo(14.8, 10);
    expect(boss.baseCombatReach).toBe(8);
  });

  it('moves melee range with the reach', () => {
    const sim = newSim();
    const boss = sim.unit('boss');
    const tank = sim.unit('t1');
    expect(withinMeleeRange(boss, tank, 0)).toBe(false); // 14 > 8 + 1.5 + 4/3
    for (let i = 0; i < 3; i++) applyAura(sim, 'swell', 'boss', 'boss', []);
    expect(withinMeleeRange(boss, tank, 0)).toBe(true); // 14 <= 12.8 + 1.5 + 4/3
  });

  it('restores the reach when the aura goes', () => {
    const sim = newSim();
    applyAura(sim, 'swell', 'boss', 'boss', []);
    applyAura(sim, 'swell', 'boss', 'boss', []);
    removeAuras(sim, 'boss', 'swell', 'removed', []);
    expect(sim.unit('boss').combatReach).toBe(8);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/scale.test.ts`
Expected: FAIL — `scaleOf` is not exported from `../src/stats`.

- [ ] **Step 3: Extend the stat kinds.** In `packages/engine/src/catalog.ts` replace

```ts
/** Aura effects on unit stats (stats.ts): MOD_ATTACKSPEED / MOD_MELEE_HASTE (A-031). */
export interface StatModifier {
  readonly kind: 'attack_speed_pct';
```
with
```ts
/** Aura effects on unit stats (stats.ts): MOD_ATTACKSPEED / MOD_MELEE_HASTE (A-031), MOD_SCALE (A-032). */
export interface StatModifier {
  readonly kind: 'attack_speed_pct' | 'scale_pct';
```

- [ ] **Step 4: Keep the base reach.** In `packages/engine/src/units.ts`, in `interface Unit`, replace

```ts
  readonly speedYdPerSec: number;
  readonly combatReach: number;
  readonly boundingRadius: number;
  readonly level: number;
```
with
```ts
  readonly speedYdPerSec: number;
  /** Combat reach at scale 1 (creature_model_info, or the player default). */
  readonly baseCombatReach: number;
  /** baseCombatReach × scale (stats.ts, A-032). */
  combatReach: number;
  readonly boundingRadius: number;
  readonly level: number;
```
and in `createUnit` replace
```ts
    combatReach: init.combatReach,
```
with
```ts
    baseCombatReach: init.combatReach,
    combatReach: init.combatReach,
```

- [ ] **Step 5: Compute scale in `packages/engine/src/stats.ts`.**

Replace
```ts
  return (def.modifiers ?? []).some((m) => m.kind === 'attack_speed_pct');
}
```
with
```ts
  return (def.modifiers ?? []).some((m) => m.kind === 'attack_speed_pct' || m.kind === 'scale_pct');
}

/** MOD_SCALE amounts are summed and added to the native scale 1 (Unit.cpp 12829–12835); never below 0. */
export function scaleOf(sim: Simulation, unit: Unit): number {
  let scale = 1;
  for (const pct of statAmounts(sim, unit, 'scale_pct')) scale += pct / 100;
  return Math.max(0, scale);
}
```
and replace
```ts
  const u = sim.unit(unitId);
  const f = swingTimeFactor(sim, u);
```
with
```ts
  const u = sim.unit(unitId);
  // Combat reach = model reach × scale (Creature.cpp 3591–3607).
  u.combatReach = u.baseCombatReach * scaleOf(sim, u);
  const f = swingTimeFactor(sim, u);
```

- [ ] **Step 6: Add A-032 to `docs/adaptations.md`:**

```markdown
| A-032 | Scale auras (MOD_SCALE) are summed and added to the native scale 1 (Unit.cpp 12829–12835); combat reach = the unit's base reach × scale (Creature.cpp 3591–3607), which moves melee range and the target-selection distances. The bounding radius is not scaled (the engine does not read it). | Inhaled Blight and Berserk grow Festergut. | `scale.test.ts` |
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/scale.test.ts packages/engine/test/combat-fields.test.ts`
Expected: PASS (`scale.test.ts` 3 tests).

- [ ] **Step 8: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): scale auras set the combat reach (A-032)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: `selectTarget` bounds, `playersOnly` and `countTargets` (research §10.11 and §5, rewrites A-021)

`DefaultTargetSelector` rejects a unit with a negative distance when `IsWithinCombatRange(target, |dist|)`, i.e. centre distance² < (dist + both reaches)² (UnitAI.h 53–100, Unit.cpp 774–788): a minimum distance is inclusive; a positive distance keeps units within combat range, strictly. Vile Gas counts qualifying players first (`SelectTargetList` up to 8) and picks among them only when there are enough.

**Files:**
- Modify: `packages/engine/src/movement.ts`, `packages/engine/src/boss.ts`, `docs/adaptations.md`
- Test changes: `packages/engine/test/boss-targeting.test.ts`

**Changed behaviour:** `minDistanceYd` was strict (edge distance > bound) and `maxDistanceYd` inclusive (≤); now minimum inclusive and maximum strict, compared on centre distance against bound + both reaches. Updated: A-021; in `boss-targeting.test.ts` the test "treats minDistanceYd as strict and maxDistanceYd as inclusive at the exact edge distance" is replaced by the inverse boundary test below; two tests are added.

- [ ] **Step 1: Change the tests in `packages/engine/test/boss-targeting.test.ts`.**

Delete the import line
```ts
import { edgeDistance } from '../src/movement';
```

Replace the test
```ts
  it('treats minDistanceYd as strict and maxDistanceYd as inclusive at the exact edge distance', () => {
    const sim = newSim();
    const d = edgeDistance(sim.unit('boss'), sim.unit('t1'), sim.now);
    for (let i = 0; i < 20; i++) expect(sel(sim, 'a', { minDistanceYd: d })?.id).not.toBe('t1');
    for (let i = 0; i < 20; i++) expect(sel(sim, 'b', { maxDistanceYd: d })?.id).toBe('t1');
    expect(sel(sim, 'c', { minDistanceYd: d, maxDistanceYd: d })).toBeNull();
    expect(sel(sim, 'd', { minDistanceYd: d - 0.001, maxDistanceYd: d })?.id).toBe('t1');
  });
```
with
```ts
  it('minDistanceYd is inclusive and maxDistanceYd strict, on centre distance against the bound plus both reaches (A-021)', () => {
    const sim = newSim();
    const ctx = makeBossContext(sim, 'boss');
    // t1: centre distance 10 = 0.5 + 8 (boss reach) + 1.5 (player reach).
    expect(ctx.countTargets({ minDistanceYd: 0.5 })).toBe(5);
    expect(ctx.countTargets({ minDistanceYd: 0.501 })).toBe(4);
    expect(ctx.countTargets({ maxDistanceYd: 0.5 })).toBe(0);
    expect(ctx.countTargets({ maxDistanceYd: 0.501 })).toBe(1);
    expect(sel(sim, 'c', { minDistanceYd: 0.5, maxDistanceYd: 0.5 })).toBeNull();
    expect(sel(sim, 'd', { minDistanceYd: 0.5, maxDistanceYd: 0.501 })?.id).toBe('t1');
  });

  it('countTargets counts like selectTarget and draws no random numbers', () => {
    const sim = newSim();
    const ctx = makeBossContext(sim, 'boss');
    // Festergut's Vile Gas rule: edge distance >= 5, i.e. centre >= 14.5 here: h1 (25), r1 (30), r2 (35).
    expect(ctx.countTargets({ minDistanceYd: 5 })).toBe(3);
    expect(ctx.countTargets({ excludeVictim: true })).toBe(4);
    expect(Object.keys(sim.rng.usage()).filter((s) => s.startsWith('boss:'))).toEqual([]);
  });

  it('playersOnly keeps players (the threat list holds only players today)', () => {
    const sim = newSim();
    const ctx = makeBossContext(sim, 'boss');
    expect(ctx.countTargets({ playersOnly: true })).toBe(5);
    for (let i = 0; i < 10; i++) expect(ctx.selectTarget('x', { playersOnly: true, minDistanceYd: 5 })?.kind).toBe('player');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test packages/engine/test/boss-targeting.test.ts`
Expected: FAIL — `ctx.countTargets is not a function`.

- [ ] **Step 3: Add the combat-range test to `packages/engine/src/movement.ts`** (append):

```ts

/** Unit::IsWithinCombatRange (Unit.cpp 774–788) in 2D: squared centre distance < (dist + both combat reaches)², strict. */
export function withinCombatRange(a: Unit, b: Unit, dist: number, t: number): boolean {
  const p = positionAt(a, t);
  const q = positionAt(b, t);
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  const max = dist + a.combatReach + b.combatReach;
  return dx * dx + dy * dy < max * max;
}
```

- [ ] **Step 4: Use it in `packages/engine/src/boss.ts`.**

Replace
```ts
import { edgeDistance } from './movement';
```
with
```ts
import { withinCombatRange } from './movement';
```

Replace
```ts
export interface BossContext {
```
with
```ts
/** Filters of SelectTarget / SelectTargetList (DefaultTargetSelector, UnitAI.h 53–100; A-021). */
export interface TargetFilter {
  /** Keep units with edge distance >= this (inclusive): rejected when within combat range of it. */
  readonly minDistanceYd?: number;
  /** Keep units with edge distance < this (strict): IsWithinCombatRange. */
  readonly maxDistanceYd?: number;
  readonly excludeVictim?: boolean;
  /** Players only (the `playerOnly` argument). */
  readonly playersOnly?: boolean;
}

export interface BossContext {
```

Replace
```ts
  /**
   * SelectTarget(Random, ...) on the threat list from stream `boss:<id>.<mechanic>`. Distances are edge to edge (A-021):
   * minDistanceYd = must be farther than, maxDistanceYd = must be within.
   */
  selectTarget(
    mechanic: string,
    options?: { minDistanceYd?: number; maxDistanceYd?: number; excludeVictim?: boolean },
  ): Unit | null;
```
with
```ts
  /** SelectTarget(Random, ...) on the threat list, uniformly from stream `boss:<id>.<mechanic>` (A-021). */
  selectTarget(mechanic: string, options?: TargetFilter): Unit | null;
  /** How many units on the threat list pass the filter (SelectTargetList's size check); draws no random numbers. */
  countTargets(options?: TargetFilter): number;
```

Replace
```ts
  const self = sim.unit(bossId);
  const data = new Map<string, number>();
```
with
```ts
  const self = sim.unit(bossId);
  const data = new Map<string, number>();
  const candidates = (options: TargetFilter): Unit[] => {
    for (const [name, v] of [['minDistanceYd', options.minDistanceYd], ['maxDistanceYd', options.maxDistanceYd]] as const) {
      if (v !== undefined && (!Number.isFinite(v) || v < 0)) throw new Error(`invalid distance bound ${name}=${v}`);
    }
    const victim = options.excludeVictim ? victimOf(sim, bossId) : null;
    return (threatFor(sim)?.listed(bossId) ?? []).filter((u) => {
      if (options.minDistanceYd !== undefined && withinCombatRange(self, u, options.minDistanceYd, sim.now)) return false;
      if (options.maxDistanceYd !== undefined && !withinCombatRange(self, u, options.maxDistanceYd, sim.now)) return false;
      if (options.excludeVictim && victim && u.id === victim.id) return false;
      if (options.playersOnly && u.kind !== 'player') return false;
      return true;
    });
  };
```

Replace
```ts
    selectTarget: (mechanic, options = {}) => {
      for (const [name, v] of [['minDistanceYd', options.minDistanceYd], ['maxDistanceYd', options.maxDistanceYd]] as const) {
        if (v !== undefined && (!Number.isFinite(v) || v < 0)) throw new Error(`invalid distance bound ${name}=${v}`);
      }
      const victim = options.excludeVictim ? victimOf(sim, bossId) : null;
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
with
```ts
    selectTarget: (mechanic, options = {}) => sim.rng.stream(`boss:${bossId}.${mechanic}`).pick(candidates(options), 1)[0] ?? null,
    countTargets: (options = {}) => candidates(options).length,
```

- [ ] **Step 5: Rewrite A-021 in `docs/adaptations.md`.** Replace the row starting `| A-021 |` with:

```markdown
| A-021 | Boss target selection works on the threat list like DefaultTargetSelector (UnitAI.h 53–100) with IsWithinCombatRange (Unit.cpp 774–788) in 2D: `minDistanceYd` keeps units whose centre distance is ≥ bound + both combat reaches (inclusive), `maxDistanceYd` keeps centre distance < bound + both reaches (strict); `playersOnly` drops non-players. It picks uniformly at random from its own stream; `countTargets` draws nothing (SelectTargetList's draws on AzerothCore's global generator have no counterpart with named streams). SelectTarget's position argument is not modelled. | Named streams (A-007). | `boss-targeting.test.ts` |
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test packages/engine/test/boss-targeting.test.ts`
Expected: PASS (one test replaced, two added).

- [ ] **Step 7: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "fix(engine): selectTarget bounds like IsWithinCombatRange, playersOnly, countTargets (A-021)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Engage with a `who` (research §10.12 and §9, adds A-033)

The unit that pulled gets the first threat reference and becomes the victim at once (ThreatManager.cpp 410–524); then `JustEngagedWith(who)` runs, whose `DoZoneInCombat` adds every other player with 0 threat (CreatureAI.cpp 117–162), which cannot take the victim away (110 % rule).

**Files:**
- Create: `packages/engine/src/engage.ts`, `packages/engine/test/engage.test.ts`
- Modify: `packages/engine/src/boss.ts`, `packages/engine/src/run.ts`, `packages/engine/src/index.ts`, `docs/adaptations.md`
- Test changes: `packages/engine/test/run.test.ts` (two tests added)

**Changed behaviour:** `BossSetup.pull` becomes optional; a setup gives exactly one of `pull` (as before) or `puller`. The training dummy and the dummy fixture keep `pull`, so their traces do not change. New: A-033.

- [ ] **Step 1: Write the failing tests.** Create `packages/engine/test/engage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EventScriptedAI, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { engageEncounter } from '../src/engage';
import { Simulation } from '../src/sim';
import { ThreatManager, threatFor } from '../src/threat';
import type { Unit } from '../src/units';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

class Probe extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [];
  readonly seen: string[] = [];
  protected engage(ctx: BossContext, who: Unit | null): void {
    this.seen.push(`${who?.id}:${ctx.victim()?.id}:${ctx.threatList().length}`);
  }
  protected executeEvent(): void {}
}

function newSim(withThreat = true) {
  const sim = new Simulation({ seed: 5, maxDurationMs: 3000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, combatReach: 8, pos: { x: 0, y: 0 } });
  for (const id of ['a_first', 'p_pull', 'z_last']) sim.addUnit({ ...body, id, name: id, kind: 'player', role: 'ranged', pos: { x: 10, y: 0 } });
  if (withThreat) new ThreatManager(sim, 1000).install();
  return sim;
}

describe('engage with a puller (A-033)', () => {
  it('the puller becomes the victim; everyone else joins with 0 threat before the script engage code', () => {
    const sim = newSim();
    const probe = new Probe();
    const engage = engageEncounter(sim, probe, 'boss', 10, 'p_pull');
    expect(sim.trace.get(engage)?.data).toEqual({ boss: 'boss', who: 'p_pull' });
    expect(probe.seen).toEqual(['p_pull:p_pull:3']);
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'threat_target').map((e) => e.data.target)).toEqual(['p_pull']);
    expect(threatFor(sim)!.listed('boss').map((u) => u.id)).toEqual(['a_first', 'p_pull', 'z_last']);
  });

  it('rejects a who that is not a living player', () => {
    const sim = newSim();
    expect(() => engageEncounter(sim, new Probe(), 'boss', 10, 'boss')).toThrow(/living player/);
    expect(() => engageEncounter(sim, new Probe(), 'boss', 10, 'ghost')).toThrow(/living player/);
  });

  it('needs a threat manager', () => {
    expect(() => engageEncounter(newSim(false), new Probe(), 'boss', 10, 'p_pull')).toThrow(/threat manager/);
  });
});
```

In `packages/engine/test/run.test.ts` replace
```ts
import { runScenario, type ContentRegistry } from '../src/run';
```
with
```ts
import { runScenario, type BossSetup, type ContentRegistry } from '../src/run';
```
and replace
```ts
    it('rejects an explicitly empty kill set', () => {
      const r = runScenario(prepared(), withKill([]));
      expect(r).toEqual({ outcome: 'invalid', problems: [{ file: 'boss:dummy', path: '(setup)', message: 'mustKill must not be empty' }] });
    });
  });
```
with
```ts
    it('rejects an explicitly empty kill set', () => {
      const r = runScenario(prepared(), withKill([]));
      expect(r).toEqual({ outcome: 'invalid', problems: [{ file: 'boss:dummy', path: '(setup)', message: 'mustKill must not be empty' }] });
    });
  });

  describe('engage with a puller (A-033)', () => {
    const withSetup = (change: (s: BossSetup) => BossSetup): ContentRegistry => ({
      ...registry,
      bosses: new Map([['dummy', { ...dummyBoss, setup: (a) => change(dummyBoss.setup(a)) }]]),
    });

    it('names who in the engage event and makes the puller the first victim', () => {
      const r = runScenario(prepared(), withSetup(({ pull: _pull, ...rest }) => ({ ...rest, puller: () => 'p3' })));
      if (r.outcome === 'invalid') throw new Error(JSON.stringify(r.problems));
      expect(r.trace.events.find((e) => e.kind === 'engage')?.data).toEqual({ boss: 'dummy', who: 'p3' });
      expect(r.trace.events[0]).toMatchObject({ kind: 'threat_target', data: { boss: 'dummy', target: 'p3', previous: null } });
    });

    it('rejects a setup with both pull and puller, or with neither', () => {
      const problem = { outcome: 'invalid', problems: [{ file: 'boss:dummy', path: '(setup)', message: 'a boss setup needs exactly one of pull and puller' }] };
      expect(runScenario(prepared(), withSetup((s) => ({ ...s, puller: () => 't1' })))).toEqual(problem);
      expect(runScenario(prepared(), withSetup(({ pull: _pull, ...rest }) => rest))).toEqual(problem);
    });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test packages/engine/test/engage.test.ts packages/engine/test/run.test.ts`
Expected: FAIL — cannot resolve `../src/engage`; in `run.test.ts` the puller is ignored (the engage event has no `who`).

- [ ] **Step 3: Pass `who` through `packages/engine/src/boss.ts`.**

Replace
```ts
  onEngage(ctx: BossContext): void;
  updateAI(ctx: BossContext, diffMs: number): void;
}
```
with
```ts
  /** JustEngagedWith(who): `who` is the pulling unit when the encounter starts with a puller (A-033), else null. */
  onEngage(ctx: BossContext, who: Unit | null): void;
  updateAI(ctx: BossContext, diffMs: number): void;
}
```

Replace
```ts
  onEngage(ctx: BossContext): void {
    this.events = new EventMap(ctx.sim.rng.stream(`boss:${this.bossId}.timers`));
    this.engage(ctx);
  }
```
with
```ts
  onEngage(ctx: BossContext, who: Unit | null = null): void {
    this.events = new EventMap(ctx.sim.rng.stream(`boss:${this.bossId}.timers`));
    this.engage(ctx, who);
  }
```

Replace
```ts
  protected abstract engage(ctx: BossContext): void;
```
with
```ts
  protected abstract engage(ctx: BossContext, who: Unit | null): void;
```

Replace
```ts
/** Emits engage, calls onEngage, and runs updateAI every intervalMs (A-002). Returns the engage event id. */
export function attachBoss(sim: Simulation, script: BossScript, bossUnitId: string, intervalMs: number): string {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) throw new Error('AI update interval must be a positive integer');
  let ids = attached.get(sim);
  if (!ids) attached.set(sim, (ids = new Set()));
  if (ids.has(bossUnitId)) throw new Error(`boss ${bossUnitId} is already attached`);
  const ctx = makeBossContext(sim, bossUnitId);
  ids.add(bossUnitId);
  const engage = sim.emit('engage', { boss: bossUnitId });
  script.onEngage(ctx);
```
with
```ts
/**
 * Emits engage, calls onEngage, and runs updateAI every intervalMs (A-002). With `whoId` (A-033) the engage event names
 * the pulling unit and every living player joins the threat list with 0 threat before the script's engage code
 * (BossAI::_JustEngagedWith → DoZoneInCombat, CreatureAI.cpp 117–162). Returns the engage event id.
 */
export function attachBoss(sim: Simulation, script: BossScript, bossUnitId: string, intervalMs: number, whoId?: string): string {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) throw new Error('AI update interval must be a positive integer');
  let ids = attached.get(sim);
  if (!ids) attached.set(sim, (ids = new Set()));
  if (ids.has(bossUnitId)) throw new Error(`boss ${bossUnitId} is already attached`);
  const who = whoId === undefined ? null : sim.unit(whoId);
  const ctx = makeBossContext(sim, bossUnitId);
  ids.add(bossUnitId);
  const engage = sim.emit('engage', who ? { boss: bossUnitId, who: who.id } : { boss: bossUnitId });
  if (who) {
    for (const p of sim.players()) if (p.alive) threatFor(sim)?.add(bossUnitId, p.id, 0, [engage]);
  }
  script.onEngage(ctx, who);
```

- [ ] **Step 4: Write `packages/engine/src/engage.ts`:**

```ts
import { attachBoss, type BossScript } from './boss';
import type { Simulation } from './sim';
import { threatFor } from './threat';

/**
 * Starts an encounter the way AzerothCore engages a creature (research §9, A-033): the pulling player gets the first
 * threat reference and becomes the victim at once (ThreatManager.cpp 410–524); then the engage event, zone-in-combat
 * for every other living player with 0 threat, and the script's engage code. Returns the engage event id.
 */
export function engageEncounter(sim: Simulation, script: BossScript, bossUnitId: string, intervalMs: number, whoId: string): string {
  const threat = threatFor(sim);
  if (!threat) throw new Error('engageEncounter needs a threat manager');
  const who = sim.units.get(whoId);
  if (!who || who.kind !== 'player' || !who.alive) throw new Error(`engage needs a living player as who, got ${whoId}`);
  threat.add(bossUnitId, whoId, 0);
  return attachBoss(sim, script, bossUnitId, intervalMs, whoId);
}
```

In `packages/engine/src/index.ts` add after `export * from './effects';`:
```ts
export * from './engage';
```

- [ ] **Step 5: Let the runner use a puller.** In `packages/engine/src/run.ts`:

Replace
```ts
import { CORE_DATA } from './core-data';
```
with
```ts
import { CORE_DATA } from './core-data';
import { engageEncounter } from './engage';
```

Replace
```ts
  /** Sets initial aggro once every player exists. */
  pull(sim: Simulation): void;
}
```
with
```ts
  /** Sets initial aggro once every player exists. Give exactly one of `pull` and `puller`. */
  pull?(sim: Simulation): void;
  /** The pulling player's id, once every player exists: the encounter engages with `who` (A-033). */
  puller?(sim: Simulation): string;
}
```

Replace
```ts
  for (const id of killSet) sim.mustKill.add(id);
```
with
```ts
  for (const id of killSet) sim.mustKill.add(id);
  if ((setup.pull === undefined) === (setup.puller === undefined)) {
    return setupFailure(`boss:${boss.id}`, new Error('a boss setup needs exactly one of pull and puller'));
  }
```

Replace
```ts
  const aiUpdateIntervalMs = data.num('core.ai_update_interval_ms');
  attachBoss(sim, setup.script, setup.bossUnitId, aiUpdateIntervalMs);
  try {
    setup.pull(sim);
  } catch (e) {
    return setupFailure(`boss:${boss.id}`, e);
  }
```
with
```ts
  const aiUpdateIntervalMs = data.num('core.ai_update_interval_ms');
  if (setup.puller) {
    try {
      engageEncounter(sim, setup.script, setup.bossUnitId, aiUpdateIntervalMs, setup.puller(sim));
    } catch (e) {
      return setupFailure(`boss:${boss.id}`, e);
    }
  } else {
    attachBoss(sim, setup.script, setup.bossUnitId, aiUpdateIntervalMs);
    try {
      setup.pull!(sim);
    } catch (e) {
      return setupFailure(`boss:${boss.id}`, e);
    }
  }
```

- [ ] **Step 6: Add A-033 to `docs/adaptations.md`:**

```markdown
| A-033 | Engage with a puller (`puller` in the boss setup): the pulling player gets the first threat reference and becomes the victim; the engage event records `who`; every living player then joins the threat list with 0 threat before the script's engage code runs (ThreatManager.cpp 410–524, BossAI::_JustEngagedWith → DoZoneInCombat, CreatureAI.cpp 117–162). DoZoneInCombat's 250 yd limit is not modelled. A setup gives exactly one of `pull` and `puller`. | The room is smaller than 250 yd. | `engage.test.ts`, `run.test.ts` |
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test packages/engine/test/engage.test.ts packages/engine/test/run.test.ts packages/engine/test/boss.test.ts`
Expected: PASS (`engage.test.ts` 3 tests; `run.test.ts` with the two new tests; the pinned fingerprint unchanged).

- [ ] **Step 8: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): engage with the pulling unit and zone-in-combat (A-033)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Difficulty-variant resolution with the heroic fallback (research §10.14 and §0)

`GetSpellIdForDifficulty` (SpellMgr.cpp 538–578) reads the SpellDifficulty row of a spell; an empty heroic slot falls back two modes (10h → 10n, 25h → 25n); a slot that is still empty keeps the given id. Plan 2b-2 uses it when building Festergut's catalog and in scripts (Inoculated, Inhaled Blight).

**Files:**
- Create: `packages/content/src/spelldata/file.ts`, `packages/content/src/spelldata/variants.ts`, `packages/content/test/spelldata-variants.test.ts`
- Modify: `packages/content/src/index.ts`

**Changed behaviour:** none (new module).

- [ ] **Step 1: Write the failing test** `packages/content/test/spelldata-variants.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpellDataFile } from '../src/spelldata/file';
import { SpellVariants } from '../src/spelldata/variants';

const FILE = parseSpellDataFile(JSON.parse(readFileSync(new URL('../data/spelldata/festergut.json', import.meta.url), 'utf8')));
const variants = new SpellVariants(FILE);
const synthetic = (spells: unknown[]) => parseSpellDataFile({ client: 'test', files: [], spells });

describe('difficulty variants (GetSpellIdForDifficulty)', () => {
  it('Inhaled Blight: 25n has its own id, heroic slots are empty and fall back two modes', () => {
    expect(variants.variantFor(69166, '10n')).toBe(69166);
    expect(variants.variantFor(69166, '25n')).toBe(71912);
    expect(variants.variantFor(69166, '10h')).toBe(69166);
    expect(variants.variantFor(69166, '25h')).toBe(71912);
  });

  it('Pungent Blight has four ids, and any id of the row finds the row', () => {
    expect(variants.variantFor(69195, '25h')).toBe(73032);
    expect(variants.variantFor(71219, '10n')).toBe(69195);
    expect(variants.variantFor(73031, '25n')).toBe(71219);
  });

  it('a spell without a row keeps its id; Gas Spore falls back in heroic', () => {
    expect(variants.variantFor(69165, '25n')).toBe(69165);
    expect(variants.variantFor(69278, '10h')).toBe(69278);
    expect(variants.variantFor(69278, '25h')).toBe(71221);
  });

  it('a normal slot that is empty keeps the given id', () => {
    const v = new SpellVariants(synthetic([{ id: 100, effects: [], difficultyVariants: [100, 0, 0, 0] }]));
    expect(v.variantFor(100, '25n')).toBe(100);
    expect(v.variantFor(100, '25h')).toBe(100);
  });

  it('rejects rows of the wrong length and an id in two rows', () => {
    expect(() => new SpellVariants(synthetic([{ id: 1, effects: [], difficultyVariants: [1, 2, 3] }]))).toThrow(/needs 4 ids/);
    expect(
      () =>
        new SpellVariants(
          synthetic([
            { id: 1, effects: [], difficultyVariants: [1, 2, 0, 0] },
            { id: 3, effects: [], difficultyVariants: [3, 2, 0, 0] },
          ]),
        ),
    ).toThrow(/spell 2 is in two difficulty rows/);
  });

  it('rejects files that are not spell data', () => {
    expect(() => parseSpellDataFile(null)).toThrow(/not a spell data file/);
    expect(() => parseSpellDataFile({ files: [], spells: [{ id: 'x', effects: [] }] })).toThrow(/integer id/);
    expect(() => parseSpellDataFile({ files: [], spells: [{ id: 1, effects: [] }, { id: 1, effects: [] }] })).toThrow(/duplicate spell 1/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/content/test/spelldata-variants.test.ts`
Expected: FAIL, cannot resolve `../src/spelldata/file`.

- [ ] **Step 3: Write `packages/content/src/spelldata/file.ts`:**

```ts
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
```

- [ ] **Step 4: Write `packages/content/src/spelldata/variants.ts`:**

```ts
import type { Difficulty } from '@raid/data';
import type { SpellDataFile } from './file';

/** Slot of each difficulty in a SpellDifficulty row: [10n, 25n, 10h, 25h]. */
const SLOT: Readonly<Record<Difficulty, number>> = { '10n': 0, '25n': 1, '10h': 2, '25h': 3 };

/** Difficulty variants of the spells in a spell data file, found by any id of their row. */
export class SpellVariants {
  private readonly rows = new Map<number, readonly number[]>();

  constructor(file: SpellDataFile) {
    for (const s of file.spells) {
      const row = s.difficultyVariants;
      if (!row) continue;
      if (row.length !== 4) throw new Error(`spell ${s.id}: difficultyVariants needs 4 ids, has ${row.length}`);
      for (const id of row) {
        if (id === 0) continue;
        const known = this.rows.get(id);
        if (known && known.join(',') !== row.join(',')) throw new Error(`spell ${id} is in two difficulty rows`);
        this.rows.set(id, row);
      }
    }
  }

  /**
   * GetSpellIdForDifficulty (SpellMgr.cpp 538–578): the row's id for the difficulty; an empty heroic slot falls back two
   * modes (10h → 10n, 25h → 25n); a slot that is still empty, or a spell without a row, keeps the given id.
   */
  variantFor(spellId: number, difficulty: Difficulty): number {
    const row = this.rows.get(spellId);
    if (!row) return spellId;
    const slot = SLOT[difficulty];
    let id = row[slot];
    if (id === 0 && slot >= 2) id = row[slot - 2];
    return id === 0 ? spellId : id;
  }
}
```

In `packages/content/src/index.ts` add after the imports:
```ts
export * from './spelldata/file';
export * from './spelldata/variants';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test packages/content/test/spelldata-variants.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/content
git commit -m "feat(content): spell data file shape and difficulty variants with the heroic fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Sourced data entries from the spell extraction (research §10.15, spec §7)

Every value taken from `festergut.json` becomes a data entry with a `spelldata` source (spell id, DBC column, the pinned data version of the file the value came from); the effect value range is `derived` from basePoints and dieSides (SpellEffectInfo::CalcValue, SpellInfo.cpp 409–447: dieSides 0 adds nothing, 1 adds exactly 1, n > 1 adds 1..n).

**Files:**
- Create: `packages/content/src/spelldata/entries.ts`, `packages/content/test/spelldata-entries.test.ts`
- Modify: `packages/content/src/index.ts`

**Changed behaviour:** none (new module).

- [ ] **Step 1: Write the failing test** `packages/content/test/spelldata-entries.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { DataRegistry } from '@raid/data';
import { describe, expect, it } from 'vitest';
import { spellDataEntries, spellKey } from '../src/spelldata/entries';
import { parseSpellDataFile } from '../src/spelldata/file';

const FILE = parseSpellDataFile(JSON.parse(readFileSync(new URL('../data/spelldata/festergut.json', import.meta.url), 'utf8')));

describe('spell data entries', () => {
  it('builds entries the data registry accepts, with derived effect ranges', () => {
    const data = new DataRegistry(spellDataEntries(FILE, [71219, 72101, 69157, 72228]));
    expect(data.num('spell.71219.e0.min')).toBe(48750);
    expect(data.num('spell.71219.e0.max')).toBe(51250);
    expect(data.num('spell.71219.cast_time_ms')).toBe(3000);
    expect(data.num('spell.71219.e0.radius_yd')).toBe(50000);
    expect(data.num('spell.71219.school_mask')).toBe(32);
    expect(data.num('spell.72228.e0.min')).toBe(29250);
    expect(data.num('spell.72228.e0.max')).toBe(30750);
    expect(data.num('spell.72101.e0.min')).toBe(-25);
    expect(data.num('spell.72101.e0.max')).toBe(-25);
    expect(data.num('spell.72101.max_stacks')).toBe(3);
    expect(data.num('spell.69157.duration_ms')).toBe(-1);
  });

  it('sources raw fields as spelldata with the version of their file, computed values as derived', () => {
    const entries = spellDataEntries(FILE, [71219]);
    const of = (key: string) => entries.find((e) => e.key === key)?.source;
    expect(of(spellKey(71219, 'e0.base_points'))).toEqual({
      kind: 'spelldata',
      spellId: 71219,
      field: 'EffectBasePoints[0]',
      dataVersion: 'client-12340:Spell.dbc:a17bfd2d4b0a',
    });
    expect(of('spell.71219.cast_time_ms')).toMatchObject({ kind: 'spelldata', dataVersion: 'client-12340:SpellCastTimes.dbc:919ca9b65cb1' });
    expect(of('spell.71219.e0.radius_yd')).toMatchObject({ kind: 'spelldata', dataVersion: 'client-12340:SpellRadius.dbc:409b1612d19b' });
    expect(of('spell.71219.e0.min')).toMatchObject({ kind: 'derived', inputs: ['spell.71219.e0.base_points', 'spell.71219.e0.die_sides'] });
    expect(entries.some((e) => e.key === 'spell.71219.duration_ms')).toBe(false);
  });

  it('rejects unknown spells and unpinned file versions', () => {
    expect(() => spellDataEntries(FILE, [1])).toThrow(/spell 1 is not in the spell data file/);
    const unpinned = {
      ...FILE,
      files: FILE.files.map((f) => (f.name === 'Spell.dbc' ? { ...f, dataVersion: 'client-12340:Spell.dbc:000000000000' } : f)),
    };
    expect(() => spellDataEntries(unpinned, [71219])).toThrow(/Spell.dbc version client-12340:Spell.dbc:000000000000 is not pinned/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/content/test/spelldata-entries.test.ts`
Expected: FAIL, cannot resolve `../src/spelldata/entries`.

- [ ] **Step 3: Write `packages/content/src/spelldata/entries.ts`:**

```ts
import { PINS, type DataEntry } from '@raid/data';
import type { SpellDataFile, SpellDataSpell } from './file';

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
 * version of the DBC file they come from, the effect value range as `derived` from basePoints and dieSides.
 */
export function spellDataEntries(file: SpellDataFile, ids: readonly number[]): DataEntry[] {
  const versions = new Map(file.files.map((f) => [f.name, f.dataVersion]));
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
```

In `packages/content/src/index.ts` add after `export * from './spelldata/variants';`:
```ts
export * from './spelldata/entries';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/content/test/spelldata-entries.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/content
git commit -m "feat(content): sourced data entries from the client spell extraction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Contract status and final verification

**Files:** Modify `docs/superpowers/plans/2026-11-10-contract-changes-for-plans-2-3.md`.

- [ ] **Step 1: Mark the Plan 2b items.** In the section "Found in the Plan 2a final review (for Plan 2b)" replace the list (from `- Area and cast max targets` to the last research bullet) with:

```markdown
- Area and cast max targets from a named stream (Gas Spore 2 or 3 targets chosen at launch).  (done in Plan 2b-1, Task 5)
- Casting as another unit from scripts and hooks (Gastric Explosion, Inoculated).  (done in Plan 2b-1, Tasks 9 and 10)
- An aura replacement scope for Blighted Spores: a different caster replaces the old instance with reason `replaced`, firing `afterRemove`.  (done in Plan 2b-1, Task 8)
- Spell-hook order: AzerothCore `OnEffectHitTarget` runs before the effect's default handler; hooks are needed for units hit by area sub-effects. Decide whether Inoculated reduces the same Pungent Blight hit.  (done in Plan 2b-1, Task 4: it does, damage is fixed at launch)
- Periodic amounts that scale with stacks.  (done in Plan 2b-1, Task 7)
- Attack-speed modifiers (Berserk).  (done in Plan 2b-1, Task 13; scale in Task 14)
- Whether removing a spore by death triggers its effects.  (researched: no explosion; Blighted Spores' afterRemove runs on death, Plan 2b-1 Task 9)
- Engage order and the engage "who".  (done in Plan 2b-1, Task 16)
- Stale timer windows (EventMap time-until query).  (Plan 2b-2)
- `basePoints` are raw: value = basePoints + 1..dieSides.  (done in Plan 2b-1, Task 18)
- Research before implementing (done: `docs/research/festergut-mechanics-25n.md`):
  - who applies the first ambient blight (Putricide's `ACTION_FESTERGUT_COMBAT` / the gas dummy);
  - how Gas Spore's removal produces Blighted Spores 69290;
  - the conditions rows for Inhale and Gaseous Blight targets;
  - the exact `SelectTarget` distance rule (inclusive vs strict).  (applied in Plan 2b-1, Task 15)
```

- [ ] **Step 2: Run the full verification**

Run: `pnpm test && pnpm typecheck && pnpm golden`
Expected: 426 tests pass (355 on main + 68 in the 17 new test files + 2 in `boss-targeting.test.ts` (one replaced, two added) + 2 in `run.test.ts` − 1 removed `pointToEdge` test), no type errors, `all golden runs match`.

- [ ] **Step 3: Check the adaptation register.** Run: `grep -c '^| A-0' docs/adaptations.md`
Expected: `33`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-11-10-contract-changes-for-plans-2-3.md
git commit -m "docs: contract status after plan 2b-1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Coverage (self-review)

Research §10 item → task:

| Research §10 | Task |
| --- | --- |
| 1 Area geometry, centre, enemy/ally, players only, caster included | 2 |
| 2 AoE damage avoidance modifier kind | 3 |
| 3 School masks with overlap | 1 |
| 4 Per-unit hooks for area hits, launch/hit split | 4 |
| 5 Max targets at launch from a named stream | 5 |
| 6 Aura replacement scope, afterRemove with the old instance's times | 8 |
| 7 afterRemove on death (A-012), dead caster/target, death-persistent auras | 9 |
| 8 Casting as another unit; player-caster rules (> 10 targets, no creature AoE avoidance, crits as a limitation) | 10, 6, 3 |
| 9 `trigger_spell`, `force_cast`, `periodic_trigger`, `instakill` (`linked_aura` deferred: only the P3 slow 69248 uses it) | 11, 12 |
| 10 Attack-speed and scale auras | 13, 14 |
| 11 `selectTarget` bounds, `playersOnly`, count helper | 15 |
| 12 Engage with a "who" | 16 |
| 13 Delayed first gas | Plan 2b-2 |
| 14 Difficulty resolution with the heroic fallback | 17 |
| 15 Data-driven values from basePoints + dieSides | 18 |
| 16–17 Hit/resist, crits, Vile Gas missile, root, slow, LOS | Plan 2b-2 (limitations) |
| 18 Tick before expiry | already A-001; single-tick case tested in 12 |
| §0/§7 Stacks scale every aura amount | 7 |

Changed existing behaviour → updated tests and adaptation rows: Task 2 (A-003; `auras.test.ts`, `movement.test.ts`), Task 4 (A-024), Task 7 (A-029; no number changes), Task 8 (A-016), Task 9 (A-012, A-024; two tests in `aura-scripts.test.ts`), Task 10 (A-020), Task 13 (A-031), Task 15 (A-021; `boss-targeting.test.ts`), Task 16 (A-033; `run.test.ts`). Canonical traces of existing scenarios stay unchanged throughout (Conventions).

Names used across tasks: `SchoolSet`, `schoolMask`, `schoolsOfMask`, `overlaps`, `schoolLabel` (Task 1); `LeafEffect`, `AreaEffect`, `DamageEffect`, `areaTargets`, `areaCenter`, `relationMatches` (2); `DamageRoute`, `aoeDamageFactor`, `ApplyAuraOptions`, `EffectContext.viaArea`, `AuraInstance.viaArea` (3); `OnCasterEffect`, `EffectHitContext`, `SpellScript.onEffectHitTarget`, `launchSpell`, `rollDamage`, `applyLeafEffect` (4); `limitTargets`, `LaunchOptions`, `CastOptions.maxTargets`/`targetStream` (5); `PLAYER_AOE_TARGET_CAP`, `SpellDef.ignoreCasterDamageMods`, `DamageRoute.ignoreCasterMods` (6); `AuraDef.ignoreCasterDamageMods`, `AuraInstance.periodicAmounts` (7); `stackScope: 'unit_replace'`, `AuraHookContext.expiresMs`, reason `replaced` (8); `AuraDef.deathPersistent`, `SpellDef.allowDeadCaster`/`allowDeadTarget`, `ApplyAuraOptions.allowDeadTarget`, `removeAurasOnDeath`, reason `death` (9); `CastOptions.originalCasterId`, `BossContext.castAs` (10); `TriggerSpellEffect`, `force_cast` (11); `periodic_trigger`, `instakill` (12); `StatModifier`, `AuraModifier`, `isDamageModifier`, `swingTimeFactor`, `swingIntervalMs`, `refreshStats`, `hasStatModifiers`, `Unit.swingFactor` (13); `scaleOf`, `Unit.baseCombatReach` (14); `withinCombatRange`, `TargetFilter`, `BossContext.countTargets` (15); `engageEncounter`, `BossSetup.puller`, `BossScript.onEngage(ctx, who)` (16); `SpellDataFile`, `parseSpellDataFile`, `SpellVariants.variantFor` (17); `spellDataEntries`, `spellKey` (18).

---

## Plan 2b-2 (next)

Written after this plan is merged; it builds on the rules above and adds no engine rules except the carried-over items at the end.

- **Festergut boss module and script** in `packages/content/src/festergut/`: an `EventScriptedAI` port of the EventMap from `boss_festergut.cpp` at the pinned commit (Inhale Blight with the gas step-down, Pungent Blight after the third inhale with its rescheduling of Gas Spore, Gas Spore delaying Vile Gas, Vile Gas with the "8 far players" rule via `countTargets`/`selectTarget`, Gastric Bloat on the victim with Gastric Explosion at 10 stacks via `castAs`, berserk), the Blighted Spores aura script (1 s and 10 s rules, Inoculated cast by the possibly dead holder, the highest-stack `setData` for "Flu Shot Shortage"), the Pungent Blight spell script (Inoculated and Inhaled Blight removal in `onEffectHitTarget`), mechanic statuses with every omission listed, and `puller` for the engage.
- **Spell definitions from data:** the 25n variants resolved with `SpellVariants`, every value read through `spellDataEntries` keys (radii, durations, amplitudes, stacks, max targets, school masks, attribute flags such as ONLY_ON_PLAYER, IGNORE_CASTER_DAMAGE_MODIFIERS, ALLOW_CAST_WHILE_DEAD, ALLOW_DEAD_TARGET, ALLOW_AURA_WHILE_DEAD), the script's own constants (Gas Spore 3 targets, Vile Gas 8 targets, timers) as `code` entries.
- **Data entries from the DB:** Festergut's creature stats (`creature_template`, `creature_classlevelstats`: level, health, armor, base damage, attack power, attack time, variance, damage modifier), spawn position (`creature`), model reach and bounding radius (`creature_model_info` 31006), Putricide's spawn and watch position, all as `db` sources at the pinned commit.
- **The delayed first gas:** a sourced constant (Putricide's 101.82 yd at 15 yd/s → 6788 ms after engage, `derived` from the `db` and `code` inputs) after which Festergut applies the large Gaseous Blight to himself, instead of a modelled Putricide unit.
- **Gate 1 scenarios, 25-player normal** (`scenarios/festergut/`): plan YAML with roster, spots and rules; *clean kill*, *missed spore group* (one ranged player does not join a spore group) and *late tank swap* (swap threshold too high), each with its intended observation checked by custom observation checks registered in `CONTENT.checks` (spore group members gain Inoculated; the missing player has fewer stacks and takes more Pungent Blight damage; Gastric Explosion occurs and its cause chain reaches the rule threshold).
- **English ability names** for every Festergut spell and aura in `CONTENT_TEXT_EN`, and the scenario observation texts.
- **Golden runs:** the three scenarios pinned in `scenarios/golden.json`, added deliberately.
- **Limitations listed in the mechanic statuses:** spell hit/resist for spells without ALWAYS_HIT, crits of Gastric Explosion, the Vile Gas missile delay, its root and the slow/confuse aura 69248 (LINKED), the gas visuals on NPC 36659.
- **Carried-over contract items:** timer windows from an EventMap time-until query (stale windows after `delayEventsToMax`/`reschedule`), and the open points of the contract list (`Rng.pick` on short pools, the post-outcome emit guard) where the script needs them.
