# Engine Contract and Schemas Implementation Plan (Gate 1, Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, boss-agnostic simulation core and every schema it relies on (provenance, plans, scenarios, trace, summary, limitation report), proven with a test boss, so that Plan 2 (Festergut + CLI) and Plan 3 (the three Gate 1 specs) only add content.

**Architecture:** A pnpm TypeScript monorepo without a build step (Vitest runs the `.ts` sources directly). `@raid/data` holds provenance schemas and the data registry; `@raid/engine` holds the event-driven simulation (millisecond clock, class-ordered event queue, AzerothCore-style `EventMap`, units, movement, auras, casting, boss AI, actor policies, rule engine, stand-ins, summary, runner); `@raid/format` turns the canonical trace into readable English. The engine never imports boss, class, format or CLI code; content plugs in through a `ContentRegistry`.

**Tech Stack:** Node 24, pnpm 9 via corepack, TypeScript 5.6 (strict), Vitest 2.1, zod 3.23, yaml 2.6.

**Spec:** `docs/superpowers/specs/2026-11-10-festergut-pilot-design.md` (revision 2). Section numbers below (§) refer to it.

---

## Plan split for Gate 1

| Plan | Content |
| --- | --- |
| **1 (this plan)** | Workspace, pinned sources, provenance, data registry, all engine-contract modules, plan/scenario schemas, trace and summary formats, English formatter, test boss. |
| 2 | Threat model and taunt action, boss melee, Festergut script and data, spell-data source decision, Festergut scenarios with observation checks, node CLI (`raid-sim run`), golden runs. |
| 3 | Resources, stats, hit/crit, buffs; Protection Paladin, Restoration Druid, Fire Mage with `SUPPORT.md`; resource-gain wake-ups; `use_cooldown` action; worked examples for spell and armor maths. |

Items from the spec that this plan deliberately leaves to Plan 2 or 3 are listed in the table at the end, so nothing silently drops out.

## Conventions for every task

- Run commands from the repository root `E:\raid-explainer` in Git Bash.
- pnpm is not installed globally. At the start of each shell session define `pnpm() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm "$@"; }`; every `pnpm ...` command below relies on it.
- Tests live in `packages/<pkg>/test/*.test.ts` and import sources by relative path.
- IDs of units, rules, spots, auras and spells match `^[a-z0-9_-]+$`, so they are safe inside random-stream names.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

```
package.json, pnpm-workspace.yaml, tsconfig.json, vitest.config.ts, .gitattributes, LICENSE
docs/sources.md                      pinned sources (§5)
docs/adaptations.md                  documented differences from AzerothCore (§5.1, §8)
packages/data/src/
  difficulty.ts                      Difficulty enum
  pins.ts                            pinned commit and allowed spell-data versions
  provenance.ts                      Source kinds, DataEntry, OverrideEntry schemas (§7)
  zod-format.ts                      zod issue → readable string
  registry.ts                        DataRegistry: baseline + overrides, access log (§3 D2, §6.4)
  index.ts
packages/engine/src/
  rng.ts                             seeded streams (§8.7)
  queue.ts                           class-ordered event queue (§8.1, §8.2)
  eventmap.ts                        AzerothCore EventMap semantics (§5.1)
  trace.ts                           trace events, snapshots, canonical JSON (§9)
  units.ts                           Unit model
  movement.ts                        continuous positions, edge distance (§8.3)
  catalog.ts                         spell/aura/effect definitions
  sim.ts                             Simulation: clock, loop, sampling, damage, heal, death, movement, outcomes
  effects.ts                         effect resolution (damage, heal, auras, area)
  auras.ts                           apply, stack, tick, expire
  casting.ts                         cast checks, GCD, cooldowns, interruption, travel time (§8.4)
  boss.ts                            BossScript, EventScriptedAI, attachBoss, victimOf, timer windows
  view.ts                            ActorView: what an actor may know (§8.6)
  controller.ts                      ActorController: policy wake-ups (§8.4)
  plan/schema.ts                     plan + scenario schemas (§10.2, §10.3)
  plan/validate.ts                   cross-reference validation
  plan/mistakes.ts                   mistake application
  plan/prepare.ts                    YAML parsing → PreparedRun or problems
  rules.ts                           RuleEngine + built-in actions (§8.5)
  standin.ts                         stand-in behaviour (§6.3)
  observations.ts                    scenario observation checks (§10.3)
  limitations.ts                     run-level limitation report (§6.4)
  summary.ts                         run summary (§9)
  core-data.ts                       sourced engine constants
  run.ts                             ContentRegistry + runScenario
  index.ts
packages/engine/test/fixtures/
  dummy-boss.ts, test-caster.ts, dummy-plan.ts
packages/format/src/
  en.ts, format.ts, index.ts
```

---

### Task 0: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `.gitattributes`, `LICENSE`
- Create: `packages/data/package.json`, `packages/engine/package.json`, `packages/format/package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write the root files**

`package.json`:
```json
{
  "name": "raid-explainer",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-only",
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/*/test/**/*.test.ts'] },
});
```

`.gitattributes`:
```
* text=auto eol=lf
```

Append to `.gitignore`:
```
coverage/
```

- [ ] **Step 2: Write the package manifests**

`packages/data/package.json`:
```json
{
  "name": "@raid/data",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-only",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "3.23.8" }
}
```

`packages/engine/package.json`:
```json
{
  "name": "@raid/engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-only",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@raid/data": "workspace:*", "yaml": "2.6.1", "zod": "3.23.8" }
}
```

`packages/format/package.json`:
```json
{
  "name": "@raid/format",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-only",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@raid/engine": "workspace:*" }
}
```

- [ ] **Step 3: Fetch the GPL-2.0 text into LICENSE**

Run: `curl -fsSL https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt -o LICENSE && head -3 LICENSE`
Expected: the first lines read `GNU GENERAL PUBLIC LICENSE` / `Version 2, June 1991`.

- [ ] **Step 4: Install**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install`
Expected: ends with `Done`, creates `pnpm-lock.yaml` and `node_modules/`.

- [ ] **Step 5: Verify the toolchain**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm test && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm typecheck`
Expected: Vitest prints `No test files found, exiting with code 0`; `tsc` prints nothing and exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json vitest.config.ts .gitattributes .gitignore LICENSE packages
git commit -m "chore: scaffold pnpm TypeScript workspace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Pinned sources and adaptation register

**Files:**
- Create: `docs/sources.md`, `docs/adaptations.md`

- [ ] **Step 1: Write `docs/sources.md`**

```markdown
# Pinned sources

Changing any entry is a deliberate change in its own commit. `packages/data/src/pins.ts` must match this file.

## AzerothCore

- Repository: https://github.com/azerothcore/azerothcore-wotlk
- Commit: `dca1a87699e380f3c19af54f9003d837c696131d` (master, 2026-11-10)
- World database revision: the SQL under `data/sql` in the same commit.

Files referenced so far:

| File | Used for |
| --- | --- |
| `src/common/Utilities/EventMap.cpp` | EventMap semantics (`packages/engine/src/eventmap.ts`) |
| `src/server/scripts/Northrend/IcecrownCitadel/boss_festergut.cpp` | Festergut (Plan 2) and the AI update pattern (`boss.ts`) |
| `src/server/apps/worldserver/worldserver.conf.dist` line 1330 | `MapUpdateInterval` default 10 ms |
| `src/server/game/Entities/Unit/Unit.cpp` line 84 | Default run speed 7.0 yd/s |
| `src/server/game/Entities/Object/ObjectDefines.h` lines 44–45 | Default object size 0.389, default combat reach 1.5 |

## Spell data

Not chosen yet. `PINS.spellDataVersions` is empty, so the data registry rejects every `spelldata`
source until the owner picks one (local client 3.3.5a build 12340 extraction, or a named and dated
public database snapshot). The choice is the first task of Plan 2.
```

- [ ] **Step 2: Write `docs/adaptations.md`**

```markdown
# Adaptations from AzerothCore

Each entry is a deliberate difference from AzerothCore behaviour, or a rule AzerothCore does not
define (player behaviour). Tests named in the last column pin the behaviour.

| ID | Rule | Reason | Test |
| --- | --- | --- | --- |
| A-001 | Events at the same millisecond run in classes: spell hits, periodic ticks, aura expiries, AI updates, player decisions; within a class in schedule order. | AzerothCore order depends on map update internals; we need a fixed, documented order (§8.2). | `queue.test.ts`, `sim.test.ts` |
| A-002 | The boss AI update runs at a fixed interval (default 10 ms, an `assumption` in `core-data.ts`). | AzerothCore's diff varies with server load. | `boss.test.ts` |
| A-003 | Distances are 2D. Range between units = centre distance − both combat reaches; area radius = distance from the area centre − the target's combat reach; never negative. | Festergut's room is flat; one rule for range and area checks until Plan 2 verifies spell-specific cases. | `movement.test.ts`, `auras.test.ts` |
| A-004 | Movement is a straight line at constant speed, no pathing. | Festergut's room has no obstacles. | `movement.test.ts` |
| A-005 | Players react to plan rule triggers after a reaction delay drawn per player; rotation decisions have no delay. | Players are not part of AzerothCore. | `rules.test.ts` |
| A-006 | Instant spells resolve inside the event that cast them. | Equivalent to AzerothCore's immediate spell handling for instant casts without travel time. | `casting.test.ts` |
| A-007 | Random numbers come from named streams per mechanic and per actor purpose. | AzerothCore uses one global generator; we need comparable runs (§8.7). | `rng.test.ts`, `run.test.ts` |
| A-008 | Healing a dead unit has no effect and writes no event. | Death is final within the millisecond (§8.2). | `sim.test.ts` |
| A-009 | Refreshing a stacking aura resets its duration and keeps its periodic tick schedule. | Simplification until a mechanic needs otherwise. | `auras.test.ts` |
| A-010 | Plan rule actions compete only for movement: a rule move pre-empts a running rule move of lower priority; other actions run regardless. | Instant actions such as taunt do not conflict with movement in the game. | `rules.test.ts` |
| A-011 | Stand-ins act once per second, produce nothing while moving, and use fixed ranges (melee and tank 5 yd, ranged and healer 40 yd). | Stand-ins are approximations by definition (§6.3). | `standin.test.ts` |
| A-012 | Removal of an aura by death does not trigger its on-expire effect. | Generic rule; a boss script can define a different behaviour for a specific aura. | `auras.test.ts` |
```

- [ ] **Step 3: Commit**

```bash
git add docs/sources.md docs/adaptations.md
git commit -m "docs: pin sources and start the adaptation register

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Provenance schemas

**Files:**
- Create: `packages/data/src/difficulty.ts`, `packages/data/src/pins.ts`, `packages/data/src/provenance.ts`, `packages/data/src/zod-format.ts`
- Test: `packages/data/test/provenance.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/data/test/provenance.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DataEntrySchema, OverrideEntrySchema, SourceSchema } from '../src/provenance';
import { PINS } from '../src/pins';

const commit = PINS.azerothcoreCommit;

describe('SourceSchema', () => {
  it('accepts every source kind', () => {
    const sources = [
      { kind: 'code', file: 'boss_festergut.cpp', commit, line: 123 },
      { kind: 'db', table: 'creature', key: 'guid=1', commit },
      { kind: 'spelldata', spellId: 69278, field: 'EffectRadiusIndex', dataVersion: 'client-12340' },
      {
        kind: 'log',
        logFile: 'logs/2026-11-01.txt',
        encounter: { server: 'rising-gods', difficulty: '25n', date: '2026-11-01' },
        uncertainty: '±0.5 s',
      },
      { kind: 'derived', formula: 'a * 2', inputs: ['x.a'] },
      { kind: 'configured', file: 'scenarios/festergut/plan.yaml' },
      { kind: 'assumption', rationale: 'no evidence yet', confirmBy: 'Gate 2 logs' },
    ];
    for (const s of sources) expect(SourceSchema.safeParse(s).success, JSON.stringify(s)).toBe(true);
  });

  it('rejects a short commit hash', () => {
    expect(SourceSchema.safeParse({ kind: 'code', file: 'a.cpp', commit: 'dca1a87', line: 1 }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(SourceSchema.safeParse({ kind: 'configured', file: 'a', extra: 1 }).success).toBe(false);
  });
});

describe('DataEntrySchema', () => {
  it('requires a source', () => {
    expect(DataEntrySchema.safeParse({ key: 'a.b', value: 1 }).success).toBe(false);
  });

  it('accepts a sourced value', () => {
    const r = DataEntrySchema.safeParse({ key: 'a.b', value: 1, source: { kind: 'configured', file: 'x' } });
    expect(r.success).toBe(true);
  });
});

describe('OverrideEntrySchema', () => {
  it('requires a log source', () => {
    const r = OverrideEntrySchema.safeParse({
      key: 'rg.a.b',
      overrides: 'a.b',
      value: 2,
      source: { kind: 'assumption', rationale: 'x', confirmBy: 'y' },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/data/test/provenance.test.ts`
Expected: FAIL, cannot resolve `../src/provenance`.

- [ ] **Step 3: Write the implementation**

`packages/data/src/difficulty.ts`:
```ts
import { z } from 'zod';

export const DifficultySchema = z.enum(['10n', '10h', '25n', '25h']);
export type Difficulty = z.infer<typeof DifficultySchema>;
```

`packages/data/src/pins.ts`:
```ts
/** Must match docs/sources.md. */
export const PINS: { readonly azerothcoreCommit: string; readonly spellDataVersions: readonly string[] } = {
  azerothcoreCommit: 'dca1a87699e380f3c19af54f9003d837c696131d',
  spellDataVersions: [],
};
```

`packages/data/src/provenance.ts`:
```ts
import { z } from 'zod';
import { DifficultySchema } from './difficulty';

const Commit = z.string().regex(/^[0-9a-f]{40}$/, 'must be a 40-character commit hash');
const NonEmpty = z.string().min(1);
export const DataKeySchema = z.string().regex(/^[a-z0-9_.]+$/, 'keys use lowercase letters, digits, _ and .');

export const SourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('code'), file: NonEmpty, commit: Commit, line: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('db'), table: NonEmpty, key: NonEmpty, commit: Commit }).strict(),
  z
    .object({ kind: z.literal('spelldata'), spellId: z.number().int().positive(), field: NonEmpty, dataVersion: NonEmpty })
    .strict(),
  z
    .object({
      kind: z.literal('log'),
      logFile: NonEmpty,
      encounter: z
        .object({ server: NonEmpty, difficulty: DifficultySchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
        .strict(),
      uncertainty: NonEmpty,
    })
    .strict(),
  z.object({ kind: z.literal('derived'), formula: NonEmpty, inputs: z.array(DataKeySchema).min(1) }).strict(),
  z.object({ kind: z.literal('configured'), file: NonEmpty }).strict(),
  z.object({ kind: z.literal('assumption'), rationale: NonEmpty, confirmBy: NonEmpty }).strict(),
]);
export type Source = z.infer<typeof SourceSchema>;
export type SourceKind = Source['kind'];

export const ValueSchema = z.union([z.number(), z.string(), z.boolean()]);
export type Value = z.infer<typeof ValueSchema>;

export const DataEntrySchema = z.object({ key: DataKeySchema, value: ValueSchema, source: SourceSchema }).strict();
export type DataEntry = z.infer<typeof DataEntrySchema>;

export const OverrideEntrySchema = z
  .object({
    key: DataKeySchema,
    overrides: DataKeySchema,
    value: ValueSchema,
    source: SourceSchema.refine((s) => s.kind === 'log', 'an override must have a log source'),
  })
  .strict();
export type OverrideEntry = z.infer<typeof OverrideEntrySchema>;
```

`packages/data/src/zod-format.ts`:
```ts
import type { ZodError } from 'zod';

export interface Issue {
  readonly path: string;
  readonly message: string;
}

export function zodIssues(error: ZodError): Issue[] {
  return error.issues.map((i) => ({ path: i.path.length ? i.path.join('.') : '(root)', message: i.message }));
}

export function formatZod(error: ZodError): string {
  return zodIssues(error)
    .map((i) => `${i.path}: ${i.message}`)
    .join('; ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/data/test/provenance.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/data
git commit -m "feat(data): provenance schemas with seven source kinds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Data registry with separate Rising-Gods overrides

**Files:**
- Create: `packages/data/src/registry.ts`, `packages/data/src/index.ts`
- Test: `packages/data/test/registry.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/data/test/registry.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DataRegistry, DataValidationError } from '../src/registry';
import { PINS } from '../src/pins';

const commit = PINS.azerothcoreCommit;
const timer = { key: 'boss.timer_ms', value: 20000, source: { kind: 'code', file: 'boss.cpp', commit, line: 10 } };
const guess = { key: 'boss.guess', value: 5, source: { kind: 'assumption', rationale: 'r', confirmBy: 'c' } };
const override = {
  key: 'rg.boss.timer_ms',
  overrides: 'boss.timer_ms',
  value: 21000,
  source: {
    kind: 'log',
    logFile: 'logs/a.txt',
    encounter: { server: 'rising-gods', difficulty: '25n', date: '2026-11-01' },
    uncertainty: '±200 ms',
  },
};

describe('DataRegistry', () => {
  it('returns the baseline value for the azerothcore profile', () => {
    const r = new DataRegistry([timer], [override], 'azerothcore');
    expect(r.num('boss.timer_ms')).toBe(20000);
    expect(r.get('boss.timer_ms').overriddenBy).toBeNull();
  });

  it('returns the override for the rising-gods profile and keeps the baseline', () => {
    const r = new DataRegistry([timer], [override], 'rising-gods');
    expect(r.num('boss.timer_ms')).toBe(21000);
    expect(r.get('boss.timer_ms').overriddenBy).toBe('rg.boss.timer_ms');
    expect(r.baselineOf('boss.timer_ms').value).toBe(20000);
  });

  it('lists overrides that exist but were not applied', () => {
    const r = new DataRegistry([timer], [override], 'azerothcore');
    r.get('boss.timer_ms');
    expect(r.knownUnappliedOverrides()).toEqual(['boss.timer_ms']);
  });

  it('records accessed entries in key order', () => {
    const r = new DataRegistry([timer, guess]);
    r.get('boss.timer_ms');
    r.get('boss.guess');
    expect(r.accessedEntries().map((e) => e.key)).toEqual(['boss.guess', 'boss.timer_ms']);
  });

  it('rejects duplicate keys, missing derived inputs, foreign commits and unpinned spell data', () => {
    const entries = [
      timer,
      timer,
      { key: 'x.derived', value: 1, source: { kind: 'derived', formula: 'a', inputs: ['x.missing'] } },
      { key: 'x.code', value: 1, source: { kind: 'code', file: 'a.cpp', commit: 'a'.repeat(40), line: 1 } },
      { key: 'x.spell', value: 1, source: { kind: 'spelldata', spellId: 1, field: 'f', dataVersion: 'v1' } },
    ];
    try {
      new DataRegistry(entries);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DataValidationError);
      const problems = (e as DataValidationError).problems.join('\n');
      expect(problems).toContain('duplicate key boss.timer_ms');
      expect(problems).toContain('derived input x.missing does not exist');
      expect(problems).toContain('is not the pinned AzerothCore commit');
      expect(problems).toContain('spell data version v1 is not pinned');
    }
  });

  it('rejects an override of an unknown key', () => {
    expect(() => new DataRegistry([], [override])).toThrow(/unknown baseline key boss.timer_ms/);
  });

  it('throws on unknown keys and non-numbers', () => {
    const r = new DataRegistry([{ key: 'a.s', value: 'x', source: { kind: 'configured', file: 'f' } }]);
    expect(() => r.get('nope')).toThrow(/unknown data key/);
    expect(() => r.num('a.s')).toThrow(/is not a number/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/data/test/registry.test.ts`
Expected: FAIL, cannot resolve `../src/registry`.

- [ ] **Step 3: Write the implementation**

`packages/data/src/registry.ts`:
```ts
import { DataEntrySchema, OverrideEntrySchema, type DataEntry, type Source, type Value } from './provenance';
import { PINS } from './pins';
import { formatZod } from './zod-format';

export type Profile = 'azerothcore' | 'rising-gods';

export interface Resolved {
  readonly key: string;
  readonly value: Value;
  readonly source: Source;
  /** Key of the Rising-Gods override that supplied the value, or null for the baseline. */
  readonly overriddenBy: string | null;
}

export class DataValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`data validation failed:\n- ${problems.join('\n- ')}`);
    this.name = 'DataValidationError';
  }
}

interface StoredOverride {
  readonly key: string;
  readonly value: Value;
  readonly source: Source;
}

const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export class DataRegistry {
  private readonly baseline = new Map<string, DataEntry>();
  private readonly overrides = new Map<string, StoredOverride>();
  private readonly accessed = new Map<string, Resolved>();

  constructor(
    entries: readonly unknown[],
    overrides: readonly unknown[] = [],
    readonly profile: Profile = 'azerothcore',
  ) {
    const problems: string[] = [];
    entries.forEach((raw, i) => {
      const r = DataEntrySchema.safeParse(raw);
      if (!r.success) {
        problems.push(`entry ${i}: ${formatZod(r.error)}`);
        return;
      }
      if (this.baseline.has(r.data.key)) {
        problems.push(`entry ${i}: duplicate key ${r.data.key}`);
        return;
      }
      this.baseline.set(r.data.key, r.data);
    });
    overrides.forEach((raw, i) => {
      const r = OverrideEntrySchema.safeParse(raw);
      if (!r.success) {
        problems.push(`override ${i}: ${formatZod(r.error)}`);
        return;
      }
      if (!this.baseline.has(r.data.overrides)) {
        problems.push(`override ${i}: unknown baseline key ${r.data.overrides}`);
        return;
      }
      if (this.overrides.has(r.data.overrides)) {
        problems.push(`override ${i}: second override for ${r.data.overrides}`);
        return;
      }
      this.overrides.set(r.data.overrides, { key: r.data.key, value: r.data.value, source: r.data.source });
    });
    for (const e of this.baseline.values()) {
      const s = e.source;
      if (s.kind === 'derived') {
        for (const input of s.inputs) {
          if (!this.baseline.has(input)) problems.push(`${e.key}: derived input ${input} does not exist`);
        }
      }
      if ((s.kind === 'code' || s.kind === 'db') && s.commit !== PINS.azerothcoreCommit) {
        problems.push(`${e.key}: commit ${s.commit} is not the pinned AzerothCore commit`);
      }
      if (s.kind === 'spelldata' && !PINS.spellDataVersions.includes(s.dataVersion)) {
        problems.push(`${e.key}: spell data version ${s.dataVersion} is not pinned in pins.ts`);
      }
    }
    if (problems.length > 0) throw new DataValidationError(problems);
  }

  get(key: string): Resolved {
    const base = this.baseline.get(key);
    if (!base) throw new Error(`unknown data key: ${key}`);
    const ov = this.profile === 'rising-gods' ? this.overrides.get(key) : undefined;
    const resolved: Resolved = ov
      ? { key, value: ov.value, source: ov.source, overriddenBy: ov.key }
      : { key, value: base.value, source: base.source, overriddenBy: null };
    this.accessed.set(key, resolved);
    return resolved;
  }

  num(key: string): number {
    const v = this.get(key).value;
    if (typeof v !== 'number') throw new Error(`data key ${key} is not a number`);
    return v;
  }

  baselineOf(key: string): DataEntry {
    const base = this.baseline.get(key);
    if (!base) throw new Error(`unknown data key: ${key}`);
    return base;
  }

  accessedEntries(): Resolved[] {
    return [...this.accessed.values()].sort(byKey);
  }

  /** Baseline keys that were used, have a Rising-Gods override, and were not overridden in this run. */
  knownUnappliedOverrides(): string[] {
    return this.accessedEntries()
      .filter((r) => r.overriddenBy === null && this.overrides.has(r.key))
      .map((r) => r.key);
  }
}
```

`packages/data/src/index.ts`:
```ts
export * from './difficulty';
export * from './pins';
export * from './provenance';
export * from './registry';
export * from './zod-format';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test packages/data`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/data
git commit -m "feat(data): registry keeping AzerothCore baseline and Rising-Gods overrides apart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Seeded random streams

**Files:**
- Create: `packages/engine/src/rng.ts`
- Test: `packages/engine/test/rng.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/rng.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../src/rng';

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('RngRegistry', () => {
  it('is deterministic per seed and stream name', () => {
    const a = new RngRegistry(42).stream('boss:festergut.gas_spore');
    const b = new RngRegistry(42).stream('boss:festergut.gas_spore');
    expect([a.nextU32(), a.nextU32(), a.nextU32()]).toEqual([b.nextU32(), b.nextU32(), b.nextU32()]);
  });

  it('gives different sequences to different names and seeds', () => {
    const base = new RngRegistry(42).stream('x').nextU32();
    expect(new RngRegistry(42).stream('y').nextU32()).not.toBe(base);
    expect(new RngRegistry(43).stream('x').nextU32()).not.toBe(base);
  });

  it('keeps streams independent', () => {
    const clean = new RngRegistry(7);
    const busy = new RngRegistry(7);
    for (let i = 0; i < 100; i++) busy.stream('unit:p1.amount').nextU32();
    expect(busy.stream('boss:b.targets').nextU32()).toBe(clean.stream('boss:b.targets').nextU32());
  });

  it('int is inclusive on both ends and validates the range', () => {
    const r = new RngRegistry(1).stream('t');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
    expect(() => r.int(3, 1)).toThrow(/invalid range/);
    expect(() => r.int(0.5, 1)).toThrow(/invalid range/);
  });

  it('pick depends on the set of ids, not their order', () => {
    const items = [{ id: 'c' }, { id: 'a' }, { id: 'd' }, { id: 'b' }];
    const p1 = new RngRegistry(9).stream('pick').pick(items, 2);
    const p2 = new RngRegistry(9).stream('pick').pick([...items].reverse(), 2);
    expect(ids(p1)).toEqual(ids(p2));
    expect(p1).toHaveLength(2);
  });

  it('pick returns every item when n exceeds the pool', () => {
    const r = new RngRegistry(9).stream('pick');
    expect(ids(r.pick([{ id: 'a' }, { id: 'b' }], 5)).sort()).toEqual(['a', 'b']);
  });

  it('rejects invalid stream names and seeds', () => {
    expect(() => new RngRegistry(1).stream('Bad Name')).toThrow(/invalid stream name/);
    expect(() => new RngRegistry(1.5)).toThrow(/seed/);
  });

  it('counts draws per stream', () => {
    const reg = new RngRegistry(1);
    reg.stream('b').nextU32();
    reg.stream('a').int(1, 2);
    expect(reg.usage()).toEqual({ a: 1, b: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/rng.test.ts`
Expected: FAIL, cannot resolve `../src/rng`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/rng.ts`:
```ts
const STREAM_NAME = /^[a-z0-9_.:-]+$/;

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 generator. */
export class Rng {
  private state: number;
  private count = 0;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  nextU32(): number {
    this.count++;
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** Inclusive on both ends, like AzerothCore's urand. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) throw new Error(`invalid range ${min}..${max}`);
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** Up to n items. The result depends only on the set of ids and the stream state, not on input order. */
  pick<T extends { readonly id: string }>(items: readonly T[], n: number): T[] {
    const pool = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const k = Math.min(n, pool.length);
    for (let i = 0; i < k; i++) {
      const j = this.int(i, pool.length - 1);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, k);
  }

  get draws(): number {
    return this.count;
  }
}

export class RngRegistry {
  private readonly streams = new Map<string, Rng>();

  constructor(private readonly seed: number) {
    if (!Number.isInteger(seed) || seed < 0) throw new Error(`seed must be a non-negative integer, got ${seed}`);
  }

  stream(name: string): Rng {
    if (!STREAM_NAME.test(name)) throw new Error(`invalid stream name: ${name}`);
    let s = this.streams.get(name);
    if (!s) {
      s = new Rng(fnv1a(`${this.seed}|${name}`));
      this.streams.set(name, s);
    }
    return s;
  }

  usage(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of [...this.streams.keys()].sort()) out[name] = this.streams.get(name)!.draws;
    return out;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/rng.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/rng.ts packages/engine/test/rng.test.ts
git commit -m "feat(engine): seeded independent random streams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Class-ordered event queue

**Files:**
- Create: `packages/engine/src/queue.ts`
- Test: `packages/engine/test/queue.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/queue.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { EventClass, EventQueue } from '../src/queue';

function drain(q: EventQueue): string[] {
  const out: string[] = [];
  for (let e = q.pop(); e; e = q.pop()) e.run();
  return out;
}

describe('EventQueue', () => {
  it('orders by time, then class, then schedule order (A-001)', () => {
    const q = new EventQueue();
    const seen: string[] = [];
    q.push(200, EventClass.SpellHit, () => seen.push('hit@200'));
    q.push(100, EventClass.Decision, () => seen.push('decision@100'));
    q.push(100, EventClass.AuraExpiry, () => seen.push('expiry@100'));
    q.push(100, EventClass.SpellHit, () => seen.push('hit1@100'));
    q.push(100, EventClass.SpellHit, () => seen.push('hit2@100'));
    q.push(100, EventClass.PeriodicTick, () => seen.push('tick@100'));
    q.push(100, EventClass.AiUpdate, () => seen.push('ai@100'));
    drain(q);
    expect(seen).toEqual(['hit1@100', 'hit2@100', 'tick@100', 'expiry@100', 'ai@100', 'decision@100', 'hit@200']);
  });

  it('skips cancelled events', () => {
    const q = new EventQueue();
    const seen: string[] = [];
    const a = q.push(10, EventClass.SpellHit, () => seen.push('a'));
    q.push(20, EventClass.SpellHit, () => seen.push('b'));
    q.cancel(a);
    expect(q.size).toBe(1);
    expect(q.peek()?.time).toBe(20);
    drain(q);
    expect(seen).toEqual(['b']);
  });

  it('rejects invalid times', () => {
    const q = new EventQueue();
    expect(() => q.push(-1, EventClass.SpellHit, () => {})).toThrow(/invalid event time/);
    expect(() => q.push(1.5, EventClass.SpellHit, () => {})).toThrow(/invalid event time/);
  });

  it('handles many events in heap order', () => {
    const q = new EventQueue();
    const times = [50, 10, 40, 30, 20, 10, 60, 0];
    const seen: number[] = [];
    for (const t of times) q.push(t, EventClass.SpellHit, () => seen.push(t));
    drain(q);
    expect(seen).toEqual([0, 10, 10, 20, 30, 40, 50, 60]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/queue.test.ts`
Expected: FAIL, cannot resolve `../src/queue`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/queue.ts`:
```ts
/** Order of event classes at the same millisecond (spec §8.2, adaptation A-001). */
export enum EventClass {
  SpellHit = 0,
  PeriodicTick = 1,
  AuraExpiry = 2,
  AiUpdate = 3,
  Decision = 4,
}

export interface Scheduled {
  readonly time: number;
  readonly cls: EventClass;
  readonly seq: number;
  cancelled: boolean;
  readonly run: () => void;
}

function before(a: Scheduled, b: Scheduled): boolean {
  if (a.time !== b.time) return a.time < b.time;
  if (a.cls !== b.cls) return a.cls < b.cls;
  return a.seq < b.seq;
}

export class EventQueue {
  private readonly heap: Scheduled[] = [];
  private seq = 0;

  push(time: number, cls: EventClass, run: () => void): Scheduled {
    if (!Number.isInteger(time) || time < 0) throw new Error(`invalid event time ${time}`);
    const item: Scheduled = { time, cls, seq: this.seq++, cancelled: false, run };
    this.heap.push(item);
    this.up(this.heap.length - 1);
    return item;
  }

  cancel(item: Scheduled): void {
    item.cancelled = true;
  }

  peek(): Scheduled | undefined {
    this.dropCancelled();
    return this.heap[0];
  }

  pop(): Scheduled | undefined {
    this.dropCancelled();
    return this.take();
  }

  get size(): number {
    return this.heap.filter((i) => !i.cancelled).length;
  }

  private dropCancelled(): void {
    while (this.heap.length > 0 && this.heap[0].cancelled) this.take();
  }

  private take(): Scheduled | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.down(0);
    }
    return top;
  }

  private swap(i: number, j: number): void {
    const t = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = t;
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(this.heap[i], this.heap[p])) return;
      this.swap(i, p);
      i = p;
    }
  }

  private down(i: number): void {
    const n = this.heap.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && before(this.heap[l], this.heap[m])) m = l;
      if (r < n && before(this.heap[r], this.heap[m])) m = r;
      if (m === i) return;
      this.swap(i, m);
      i = m;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/queue.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/queue.ts packages/engine/test/queue.test.ts
git commit -m "feat(engine): event queue ordered by time, event class and schedule order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: AzerothCore EventMap semantics

The behaviour mirrors `src/common/Utilities/EventMap.cpp` at the pinned commit (read it before starting): events are kept in time order with insertion order for equal times; `ExecuteEvent` returns at most one due event and silently discards due events of a non-matching phase; `DelayEventsToMax` moves matching events that would fire before `now + delay` to `now + delay`, and the moved event keeps only the group passed to the call and loses its phase.

**Files:**
- Create: `packages/engine/src/eventmap.ts`
- Test: `packages/engine/test/eventmap.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/eventmap.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { EventMap } from '../src/eventmap';
import { RngRegistry } from '../src/rng';

const newMap = () => new EventMap(new RngRegistry(1).stream('test.timers'));

function drainDue(m: EventMap): number[] {
  const out: number[] = [];
  for (let id = m.execute(); id !== 0; id = m.execute()) out.push(id);
  return out;
}

describe('EventMap', () => {
  it('executes an event only once it is due', () => {
    const m = newMap();
    m.schedule(1, 1000);
    m.update(999);
    expect(m.execute()).toBe(0);
    m.update(1);
    expect(m.execute()).toBe(1);
    expect(m.execute()).toBe(0);
  });

  it('returns one due event per call, earliest first, insertion order for ties', () => {
    const m = newMap();
    m.schedule(3, 500);
    m.schedule(1, 100);
    m.schedule(2, 100);
    m.update(1000);
    expect(m.execute()).toBe(1);
    expect(m.execute()).toBe(2);
    expect(m.execute()).toBe(3);
  });

  it('scheduleRange draws an inclusive delay from its stream', () => {
    const expected = new RngRegistry(1).stream('test.timers').int(20000, 25000);
    const m = newMap();
    m.scheduleRange(7, 20000, 25000);
    m.update(expected - 1);
    expect(m.execute()).toBe(0);
    m.update(1);
    expect(m.execute()).toBe(7);
  });

  it('reschedule cancels earlier copies', () => {
    const m = newMap();
    m.schedule(1, 100);
    m.schedule(1, 200);
    m.reschedule(1, 300);
    m.update(250);
    expect(m.execute()).toBe(0);
    m.update(50);
    expect(drainDue(m)).toEqual([1]);
  });

  it('discards due events of another phase, keeps phaseless ones', () => {
    const m = newMap();
    m.schedule(1, 100, 0, 2);
    m.schedule(2, 100, 0, 0);
    m.setPhase(1);
    m.update(100);
    expect(drainDue(m)).toEqual([2]);
    expect(m.isEmpty()).toBe(true);
  });

  it('delayEventsToMax moves only matching events due before now+delay', () => {
    const m = newMap();
    m.schedule(1, 5000, 1); // group 1, early: moved
    m.schedule(2, 30000, 1); // group 1, late: untouched
    m.schedule(3, 5000, 2); // group 2: untouched
    m.delayEventsToMax(20000, 1);
    m.update(5000);
    expect(drainDue(m)).toEqual([3]);
    m.update(15000);
    expect(drainDue(m)).toEqual([1]);
    m.update(10000);
    expect(drainDue(m)).toEqual([2]);
  });

  it('delayEventsToMax drops the moved event phase, like AzerothCore', () => {
    const m = newMap();
    m.schedule(1, 100, 1, 2);
    m.delayEventsToMax(1000, 1);
    m.setPhase(1);
    m.update(1000);
    expect(m.execute()).toBe(1);
  });

  it('cancelGroup removes only that group', () => {
    const m = newMap();
    m.schedule(1, 100, 1);
    m.schedule(2, 100, 2);
    m.cancelGroup(1);
    m.update(100);
    expect(drainDue(m)).toEqual([2]);
  });

  it('delayEvents shifts every event or one group', () => {
    const m = newMap();
    m.schedule(1, 100, 1);
    m.schedule(2, 100, 2);
    m.delayEvents(50, 1);
    m.update(100);
    expect(drainDue(m)).toEqual([2]);
    m.update(50);
    expect(drainDue(m)).toEqual([1]);
  });

  it('repeat reschedules the last executed event', () => {
    const m = newMap();
    m.schedule(4, 100);
    m.update(100);
    expect(m.execute()).toBe(4);
    m.repeat(200);
    m.update(200);
    expect(m.execute()).toBe(4);
    expect(() => newMap().repeat(1)).toThrow(/before any event/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/eventmap.test.ts`
Expected: FAIL, cannot resolve `../src/eventmap`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/eventmap.ts`:
```ts
import type { Rng } from './rng';

interface Entry {
  readonly at: number;
  readonly id: number;
  readonly groupMask: number;
  readonly phaseMask: number;
}

function bit(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > 31) throw new Error(`invalid group or phase index ${index}`);
  return index === 0 ? 0 : 1 << (index - 1);
}

/**
 * Counterpart of AzerothCore's EventMap (src/common/Utilities/EventMap.cpp at the pinned commit).
 * Times are milliseconds since the map was created or reset.
 */
export class EventMap {
  private time = 0;
  private entries: Entry[] = [];
  private phaseMask = 0;
  private last: Entry | null = null;

  constructor(private readonly rng: Rng) {}

  get now(): number {
    return this.time;
  }

  update(diffMs: number): void {
    this.time += diffMs;
  }

  reset(): void {
    this.entries = [];
    this.time = 0;
    this.phaseMask = 0;
    this.last = null;
  }

  setPhase(phase: number): void {
    this.phaseMask = bit(phase);
  }

  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  schedule(id: number, delayMs: number, group = 0, phase = 0): void {
    this.insert({ at: this.time + delayMs, id, groupMask: bit(group), phaseMask: bit(phase) });
  }

  scheduleRange(id: number, minMs: number, maxMs: number, group = 0, phase = 0): void {
    this.schedule(id, this.rng.int(minMs, maxMs), group, phase);
  }

  reschedule(id: number, delayMs: number, group = 0, phase = 0): void {
    this.cancel(id);
    this.schedule(id, delayMs, group, phase);
  }

  rescheduleRange(id: number, minMs: number, maxMs: number, group = 0, phase = 0): void {
    this.cancel(id);
    this.scheduleRange(id, minMs, maxMs, group, phase);
  }

  repeat(delayMs: number): void {
    if (!this.last) throw new Error('repeat() called before any event executed');
    this.insert({ ...this.last, at: this.time + delayMs });
  }

  repeatRange(minMs: number, maxMs: number): void {
    this.repeat(this.rng.int(minMs, maxMs));
  }

  cancel(id: number): void {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  cancelGroup(group: number): void {
    if (group === 0) return;
    const m = bit(group);
    this.entries = this.entries.filter((e) => (e.groupMask & m) === 0);
  }

  /** Shifts every event (group 0) or the events of one group by delayMs. */
  delayEvents(delayMs: number, group = 0): void {
    const m = bit(group);
    const moved: Entry[] = [];
    const kept: Entry[] = [];
    for (const e of this.entries) {
      if (group === 0 || (e.groupMask & m) !== 0) moved.push({ ...e, at: e.at + delayMs });
      else kept.push(e);
    }
    this.entries = kept;
    for (const e of moved) this.insert(e);
  }

  /**
   * Events of `group` (every event if 0) due before now+delay are moved to now+delay.
   * Like AzerothCore, a moved event keeps only `group` as its group and loses its phase.
   */
  delayEventsToMax(delayMs: number, group = 0): void {
    const m = bit(group);
    const limit = this.time + delayMs;
    const moved: number[] = [];
    this.entries = this.entries.filter((e) => {
      const hit = e.at < limit && (group === 0 || (e.groupMask & m) !== 0);
      if (hit) moved.push(e.id);
      return !hit;
    });
    for (const id of moved) this.schedule(id, delayMs, group);
  }

  /** The id of one due event, or 0. Due events of a non-matching phase are discarded. */
  execute(): number {
    while (this.entries.length > 0) {
      const e = this.entries[0];
      if (e.at > this.time) return 0;
      this.entries.shift();
      if (this.phaseMask !== 0 && e.phaseMask !== 0 && (e.phaseMask & this.phaseMask) === 0) continue;
      this.last = e;
      return e.id;
    }
    return 0;
  }

  private insert(e: Entry): void {
    let i = this.entries.length;
    while (i > 0 && this.entries[i - 1].at > e.at) i--;
    this.entries.splice(i, 0, e);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/eventmap.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/eventmap.ts packages/engine/test/eventmap.test.ts
git commit -m "feat(engine): EventMap with AzerothCore semantics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Trace format and canonical JSON

**Files:**
- Create: `packages/engine/src/trace.ts`
- Test: `packages/engine/test/trace.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/trace.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TraceWriter, canonicalStringify } from '../src/trace';

describe('TraceWriter', () => {
  it('assigns sequential stable ids and keeps causes', () => {
    const w = new TraceWriter();
    const a = w.emit(0, 'engage', { boss: 'b' });
    const b = w.emit(10, 'ai_event', { boss: 'b', event: 'x' }, [a.id]);
    expect([a.id, b.id]).toEqual(['e1', 'e2']);
    expect(w.get('e2')?.causes).toEqual(['e1']);
  });

  it('rejects unknown causes', () => {
    const w = new TraceWriter();
    expect(() => w.emit(0, 'engage', {}, ['e9'])).toThrow(/unknown cause e9/);
  });

  it('copies data so later changes do not leak in', () => {
    const w = new TraceWriter();
    const data: Record<string, number> = { amount: 1 };
    const ev = w.emit(0, 'damage', data);
    data.amount = 2;
    expect(ev.data.amount).toBe(1);
  });
});

describe('canonicalStringify', () => {
  it('sorts object keys at every level and keeps array order', () => {
    expect(canonicalStringify({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });

  it('rejects non-finite numbers and functions', () => {
    expect(() => canonicalStringify({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalStringify({ a: () => 1 })).toThrow(/cannot serialise/);
  });

  it('drops undefined object members', () => {
    expect(canonicalStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/trace.test.ts`
Expected: FAIL, cannot resolve `../src/trace`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/trace.ts`:
```ts
export const EVENT_KINDS = [
  'engage',
  'ai_event',
  'cast_start',
  'cast_success',
  'cast_failed',
  'cast_interrupted',
  'spell_hit',
  'damage',
  'heal',
  'aura_applied',
  'aura_stack',
  'aura_removed',
  'periodic_tick',
  'move_start',
  'move_end',
  'rule_fired',
  'action_failed',
  'phase_change',
  'timer_window',
  'death',
  'outcome',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type TraceValue = string | number | boolean | null | readonly string[];

export interface TraceEvent {
  readonly id: string;
  readonly t: number;
  readonly kind: EventKind;
  readonly causes: readonly string[];
  readonly data: Readonly<Record<string, TraceValue>>;
}

export interface UnitSnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly alive: boolean;
  readonly auras: readonly (readonly [string, number])[];
  readonly cast: string | null;
}

export interface Snapshot {
  readonly t: number;
  readonly units: readonly UnitSnapshot[];
}

export interface TraceUnitMeta {
  readonly id: string;
  readonly name: string;
  readonly kind: 'player' | 'creature';
  readonly role: string;
  readonly approximate: boolean;
}

export interface TraceMeta {
  readonly engineVersion: string;
  readonly azerothcoreCommit: string;
  readonly spellDataVersions: readonly string[];
  readonly scenario: string;
  readonly boss: string;
  readonly difficulty: string;
  readonly seed: number;
  readonly profile: string;
  readonly aiUpdateIntervalMs: number;
  readonly sampleIntervalMs: number;
  readonly units: readonly TraceUnitMeta[];
}

export interface Trace {
  readonly schemaVersion: 1;
  readonly meta: TraceMeta;
  readonly events: readonly TraceEvent[];
  readonly snapshots: readonly Snapshot[];
}

export class TraceWriter {
  private readonly events: TraceEvent[] = [];
  private readonly snapshots: Snapshot[] = [];
  private readonly byId = new Map<string, TraceEvent>();
  private n = 0;

  emit(t: number, kind: EventKind, data: Readonly<Record<string, TraceValue>>, causes: readonly string[] = []): TraceEvent {
    for (const c of causes) if (!this.byId.has(c)) throw new Error(`unknown cause ${c}`);
    const ev: TraceEvent = { id: `e${++this.n}`, t, kind, causes: [...causes], data: { ...data } };
    this.events.push(ev);
    this.byId.set(ev.id, ev);
    return ev;
  }

  get(id: string): TraceEvent | undefined {
    return this.byId.get(id);
  }

  list(): readonly TraceEvent[] {
    return this.events;
  }

  snapshot(s: Snapshot): void {
    this.snapshots.push(s);
  }

  build(meta: TraceMeta): Trace {
    return { schemaVersion: 1, meta, events: [...this.events], snapshots: [...this.snapshots] };
  }
}

/** JSON with object keys sorted at every level, so equal traces are byte-identical. */
export function canonicalStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number in trace');
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const parts = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalStringify(o[k])}`);
    return `{${parts.join(',')}}`;
  }
  throw new Error(`cannot serialise ${typeof value}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/trace.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/trace.ts packages/engine/test/trace.test.ts
git commit -m "feat(engine): versioned trace with stable event ids, causes and canonical JSON

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Units and continuous movement

**Files:**
- Create: `packages/engine/src/units.ts`, `packages/engine/src/movement.ts`
- Test: `packages/engine/test/movement.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/movement.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { centerDistance, edgeDistance, pointToEdge, positionAt, travelTimeMs } from '../src/movement';
import { EventClass, EventQueue } from '../src/queue';
import { createUnit } from '../src/units';

const base = { kind: 'player' as const, role: 'ranged' as const, maxHealth: 100, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

describe('movement', () => {
  it('interpolates halfway through a move and stops at the target (A-004)', () => {
    const u = createUnit({ ...base, id: 'p1', name: 'P1', pos: { x: 0, y: 0 } });
    const handle = new EventQueue().push(2000, EventClass.Decision, () => {});
    u.move = { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, startMs: 0, speed: 5, arrivalMs: 2000, handle };
    expect(positionAt(u, 1000)).toEqual({ x: 5, y: 0 });
    expect(positionAt(u, 2500)).toEqual({ x: 10, y: 0 });
  });

  it('measures edge distance minus both combat reaches, never negative (A-003)', () => {
    const a = createUnit({ ...base, id: 'a', name: 'A', pos: { x: 0, y: 0 } });
    const b = createUnit({ ...base, id: 'b', name: 'B', pos: { x: 10, y: 0 } });
    expect(edgeDistance(a, b, 0)).toBe(7);
    const c = createUnit({ ...base, id: 'c', name: 'C', pos: { x: 1, y: 0 } });
    expect(edgeDistance(a, c, 0)).toBe(0);
  });

  it('measures area distance from a point to a unit edge', () => {
    const b = createUnit({ ...base, id: 'b', name: 'B', pos: { x: 9.5, y: 0 } });
    expect(pointToEdge({ x: 0, y: 0 }, b, 0)).toBe(8);
  });

  it('computes travel time rounded up to the millisecond', () => {
    expect(travelTimeMs({ x: 0, y: 0 }, { x: 7, y: 0 }, 7)).toBe(1000);
    expect(travelTimeMs({ x: 0, y: 0 }, { x: 1, y: 0 }, 3)).toBe(334);
    expect(centerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('validates unit ids and sizes', () => {
    expect(() => createUnit({ ...base, id: 'Bad Id', name: 'X', pos: { x: 0, y: 0 } })).toThrow(/invalid unit id/);
    expect(() => createUnit({ ...base, id: 'x', name: 'X', maxHealth: 0, pos: { x: 0, y: 0 } })).toThrow(/maxHealth/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/movement.test.ts`
Expected: FAIL, cannot resolve `../src/movement`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/units.ts`:
```ts
import type { Scheduled } from './queue';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export type Role = 'tank' | 'healer' | 'melee' | 'ranged' | 'boss' | 'add';

export const ID_PATTERN = /^[a-z0-9_-]+$/;

export interface Move {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly startMs: number;
  readonly speed: number;
  readonly arrivalMs: number;
  readonly handle: Scheduled;
}

export interface AuraInstance {
  readonly auraId: string;
  readonly casterId: string;
  stacks: number;
  readonly appliedMs: number;
  expiresMs: number;
  expiry: Scheduled;
  tick: Scheduled | null;
  appliedEvent: string;
}

export interface CastState {
  readonly spellId: string;
  readonly targetId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly handle: Scheduled;
  startEvent: string;
}

export interface Unit {
  readonly id: string;
  readonly name: string;
  readonly kind: 'player' | 'creature';
  readonly role: Role;
  readonly approximate: boolean;
  readonly maxHealth: number;
  health: number;
  alive: boolean;
  pos: Vec2;
  move: Move | null;
  readonly speedYdPerSec: number;
  readonly combatReach: number;
  readonly boundingRadius: number;
  /** Key: auraKey(auraId, casterId). */
  readonly auras: Map<string, AuraInstance>;
  cast: CastState | null;
  gcdUntilMs: number;
  /** spellId → time the spell is ready again. */
  readonly cooldowns: Map<string, number>;
  /** unitId → threat; used on creatures. */
  readonly threat: Map<string, number>;
  diedAtEvent: string | null;
}

export interface UnitInit {
  readonly id: string;
  readonly name: string;
  readonly kind: 'player' | 'creature';
  readonly role: Role;
  readonly approximate?: boolean;
  readonly maxHealth: number;
  readonly pos: Vec2;
  readonly speedYdPerSec: number;
  readonly combatReach: number;
  readonly boundingRadius: number;
}

export function createUnit(init: UnitInit): Unit {
  if (!ID_PATTERN.test(init.id)) throw new Error(`invalid unit id ${init.id}`);
  if (!Number.isInteger(init.maxHealth) || init.maxHealth <= 0) {
    throw new Error(`maxHealth of ${init.id} must be a positive integer`);
  }
  if (init.speedYdPerSec < 0 || init.combatReach < 0 || init.boundingRadius < 0) {
    throw new Error(`negative speed or size for ${init.id}`);
  }
  return {
    id: init.id,
    name: init.name,
    kind: init.kind,
    role: init.role,
    approximate: init.approximate ?? false,
    maxHealth: init.maxHealth,
    health: init.maxHealth,
    alive: true,
    pos: { x: init.pos.x, y: init.pos.y },
    move: null,
    speedYdPerSec: init.speedYdPerSec,
    combatReach: init.combatReach,
    boundingRadius: init.boundingRadius,
    auras: new Map(),
    cast: null,
    gcdUntilMs: 0,
    cooldowns: new Map(),
    threat: new Map(),
    diedAtEvent: null,
  };
}

export const auraKey = (auraId: string, casterId: string): string => `${auraId}|${casterId}`;

export const byId = (a: { readonly id: string }, b: { readonly id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
```

`packages/engine/src/movement.ts`:
```ts
import type { Unit, Vec2 } from './units';

export function centerDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Position at time t; straight line at constant speed (A-004). */
export function positionAt(u: Unit, t: number): Vec2 {
  const m = u.move;
  if (!m) return u.pos;
  if (t >= m.arrivalMs) return m.to;
  const total = centerDistance(m.from, m.to);
  if (total === 0) return m.to;
  const frac = (((t - m.startMs) / 1000) * m.speed) / total;
  return { x: m.from.x + (m.to.x - m.from.x) * frac, y: m.from.y + (m.to.y - m.from.y) * frac };
}

export function travelTimeMs(from: Vec2, to: Vec2, speedYdPerSec: number): number {
  if (speedYdPerSec <= 0) throw new Error('speed must be positive');
  return Math.ceil((centerDistance(from, to) / speedYdPerSec) * 1000);
}

/** Range between two units: centre distance minus both combat reaches, never negative (A-003). */
export function edgeDistance(a: Unit, b: Unit, t: number): number {
  return Math.max(0, centerDistance(positionAt(a, t), positionAt(b, t)) - a.combatReach - b.combatReach);
}

/** Area check: distance from an area centre to a unit's edge, never negative (A-003). */
export function pointToEdge(p: Vec2, u: Unit, t: number): number {
  return Math.max(0, centerDistance(p, positionAt(u, t)) - u.combatReach);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/movement.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/units.ts packages/engine/src/movement.ts packages/engine/test/movement.test.ts
git commit -m "feat(engine): unit model, continuous positions and edge distances

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Catalog and the simulation loop

**Files:**
- Create: `packages/engine/src/catalog.ts`, `packages/engine/src/sim.ts`
- Test: `packages/engine/test/sim.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/sim.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const player = { kind: 'player' as const, role: 'ranged' as const, maxHealth: 1000, speedYdPerSec: 5, combatReach: 1.5, boundingRadius: 0.389 };
const hit = (sourceId: string) => ({ sourceId, ability: 'test', school: 'physical' as const });

function newSim(maxDurationMs = 10000) {
  const sim = new Simulation({ seed: 1, maxDurationMs, sampleIntervalMs: 1000 });
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 100000, pos: { x: 0, y: 0 }, speedYdPerSec: 7, combatReach: 5, boundingRadius: 2 });
  sim.addUnit({ ...player, id: 'p1', name: 'P1', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...player, id: 'p2', name: 'P2', pos: { x: 5, y: 0 } });
  return sim;
}

const kinds = (sim: Simulation) => sim.trace.list().map((e) => e.kind);

describe('Simulation', () => {
  it('a unit killed in a millisecond cannot be healed later in that millisecond (§8.2, A-008)', () => {
    const sim = newSim();
    const heals: (string | null)[] = [];
    sim.at(100, EventClass.SpellHit, () => {
      sim.damage('p1', 5000, hit('boss'), []);
    });
    sim.at(100, EventClass.SpellHit, () => {
      heals.push(sim.heal('p1', 500, hit('p2'), []));
    });
    sim.run();
    expect(heals).toEqual([null]);
    expect(sim.unit('p1').health).toBe(0);
    expect(kinds(sim)).toEqual(['damage', 'death', 'outcome']);
    expect(sim.trace.list()[0].data).toMatchObject({ amount: 1000, overkill: 4000 });
    expect(sim.outcome?.kind).toBe('timeout');
  });

  it('runs same-millisecond events by class (A-001)', () => {
    const sim = newSim();
    const order: string[] = [];
    sim.at(50, EventClass.Decision, () => order.push('decision'));
    sim.at(50, EventClass.SpellHit, () => order.push('hit'));
    sim.run();
    expect(order).toEqual(['hit', 'decision']);
  });

  it('samples positions during a move (§8.3)', () => {
    const sim = newSim(3000);
    sim.at(0, EventClass.Decision, () => {
      sim.startMove('p1', { x: 10, y: 0 }, []);
    });
    sim.run();
    const xs = sim.trace.build(meta()).snapshots.map((s) => [s.t, s.units.find((u) => u.id === 'p1')!.x]);
    expect(xs).toEqual([
      [0, 0],
      [1000, 5],
      [2000, 10],
      [3000, 10],
    ]);
  });

  it('a new move starts from the current position', () => {
    const sim = newSim(3000);
    sim.at(0, EventClass.Decision, () => {
      sim.startMove('p1', { x: 10, y: 0 }, []);
    });
    sim.at(1000, EventClass.Decision, () => {
      sim.startMove('p1', { x: 5, y: 10 }, []);
    });
    sim.run();
    const second = sim.trace.list().filter((e) => e.kind === 'move_start')[1];
    expect(second.data).toMatchObject({ fromX: 5, fromY: 0, toX: 5, toY: 10, arrivalMs: 3000 });
  });

  it('ends with kill when every boss dies', () => {
    const sim = newSim();
    sim.at(100, EventClass.SpellHit, () => {
      sim.damage('boss', 1e6, hit('p1'), []);
    });
    expect(sim.run().kind).toBe('kill');
    expect(sim.outcome?.atMs).toBe(100);
  });

  it('ends with wipe when every player dies', () => {
    const sim = newSim();
    sim.at(100, EventClass.SpellHit, () => {
      sim.damage('p1', 1e6, hit('boss'), []);
      sim.damage('p2', 1e6, hit('boss'), []);
    });
    expect(sim.run().kind).toBe('wipe');
  });

  it('ends with timeout at the maximum duration', () => {
    const sim = newSim(5000);
    sim.at(9000, EventClass.SpellHit, () => {
      throw new Error('must not run');
    });
    const outcome = sim.run();
    expect(outcome).toMatchObject({ kind: 'timeout', atMs: 5000 });
  });

  it('refuses to schedule in the past', () => {
    const sim = newSim();
    sim.at(100, EventClass.SpellHit, () => {
      expect(() => sim.at(50, EventClass.SpellHit, () => {})).toThrow(/before now/);
    });
    sim.run();
  });

  it('death removes auras with reason death and cancels the cast', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'mark', durationMs: 5000, maxStacks: 1 });
    sim.at(0, EventClass.SpellHit, () => {
      const p1 = sim.unit('p1');
      p1.auras.set('mark|boss', {
        auraId: 'mark',
        casterId: 'boss',
        stacks: 1,
        appliedMs: 0,
        expiresMs: 5000,
        expiry: sim.at(5000, EventClass.AuraExpiry, () => {}),
        tick: null,
        appliedEvent: '',
      });
      sim.damage('p1', 1e6, hit('boss'), []);
    });
    sim.run();
    const removed = sim.trace.list().find((e) => e.kind === 'aura_removed');
    expect(removed?.data).toMatchObject({ unit: 'p1', aura: 'mark', reason: 'death' });
    expect(sim.unit('p1').auras.size).toBe(0);
  });
});

function meta() {
  return {
    engineVersion: 'test',
    azerothcoreCommit: 'x',
    spellDataVersions: [],
    scenario: 's',
    boss: 'boss',
    difficulty: '25n',
    seed: 1,
    profile: 'azerothcore',
    aiUpdateIntervalMs: 10,
    sampleIntervalMs: 1000,
    units: [],
  };
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/sim.test.ts`
Expected: FAIL, cannot resolve `../src/sim`.

- [ ] **Step 3: Write `catalog.ts`**

`packages/engine/src/catalog.ts`:
```ts
import { ID_PATTERN } from './units';

export type School = 'physical' | 'holy' | 'fire' | 'nature' | 'frost' | 'shadow' | 'arcane';

export type Effect =
  | { readonly type: 'damage'; readonly school: School; readonly min: number; readonly max: number }
  | { readonly type: 'heal'; readonly min: number; readonly max: number }
  | { readonly type: 'apply_aura'; readonly aura: string }
  | { readonly type: 'remove_aura'; readonly aura: string }
  | {
      readonly type: 'area';
      readonly radius: number;
      readonly includeCenter: boolean;
      readonly filter: 'players' | 'creatures' | 'all';
      readonly effects: readonly Effect[];
    };

export interface AuraDef {
  readonly id: string;
  readonly durationMs: number;
  readonly maxStacks: number;
  readonly periodic?: { readonly intervalMs: number; readonly effects: readonly Effect[] };
  readonly onExpire?: readonly Effect[];
}

export interface SpellDef {
  readonly id: string;
  readonly castTimeMs: number;
  readonly gcdMs: number;
  readonly cooldownMs: number;
  readonly rangeYd: number;
  readonly usableWhileMoving: boolean;
  readonly target: 'self' | 'unit';
  readonly travelSpeedYdPerSec?: number;
  readonly effects: readonly Effect[];
}

export class Catalog {
  private readonly spells = new Map<string, SpellDef>();
  private readonly auras = new Map<string, AuraDef>();

  addSpell(def: SpellDef): void {
    if (!ID_PATTERN.test(def.id)) throw new Error(`invalid spell id ${def.id}`);
    if (this.spells.has(def.id)) throw new Error(`duplicate spell ${def.id}`);
    if (def.castTimeMs < 0 || def.gcdMs < 0 || def.cooldownMs < 0 || def.rangeYd < 0) {
      throw new Error(`negative timing or range in spell ${def.id}`);
    }
    this.spells.set(def.id, def);
  }

  addAura(def: AuraDef): void {
    if (!ID_PATTERN.test(def.id)) throw new Error(`invalid aura id ${def.id}`);
    if (this.auras.has(def.id)) throw new Error(`duplicate aura ${def.id}`);
    if (def.durationMs <= 0 || !Number.isInteger(def.maxStacks) || def.maxStacks < 1) {
      throw new Error(`aura ${def.id} needs a positive duration and maxStacks >= 1`);
    }
    if (def.periodic && def.periodic.intervalMs <= 0) throw new Error(`aura ${def.id} needs a positive tick interval`);
    this.auras.set(def.id, def);
  }

  spell(id: string): SpellDef {
    const s = this.spells.get(id);
    if (!s) throw new Error(`unknown spell ${id}`);
    return s;
  }

  aura(id: string): AuraDef {
    const a = this.auras.get(id);
    if (!a) throw new Error(`unknown aura ${id}`);
    return a;
  }

  hasSpell(id: string): boolean {
    return this.spells.has(id);
  }

  hasAura(id: string): boolean {
    return this.auras.has(id);
  }
}
```

- [ ] **Step 4: Write `sim.ts`**

`packages/engine/src/sim.ts`:
```ts
import { Catalog, type School } from './catalog';
import { positionAt, travelTimeMs } from './movement';
import { EventClass, EventQueue, type Scheduled } from './queue';
import { RngRegistry } from './rng';
import { TraceWriter, type EventKind, type TraceEvent, type TraceValue, type UnitSnapshot } from './trace';
import { byId, createUnit, type Unit, type UnitInit, type Vec2 } from './units';

export type OutcomeKind = 'kill' | 'wipe' | 'timeout';

export interface Outcome {
  readonly kind: OutcomeKind;
  readonly atMs: number;
  readonly event: string;
}

export interface TimerWindow {
  readonly boss: string;
  readonly ability: string;
  readonly earliestMs: number;
  readonly latestMs: number;
}

export interface SimOptions {
  readonly seed: number;
  readonly maxDurationMs: number;
  readonly sampleIntervalMs: number;
}

export interface HitInfo {
  readonly sourceId: string;
  readonly ability: string;
  readonly school: School;
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Simulation {
  now = 0;
  phase = 'default';
  outcome: Outcome | null = null;
  readonly queue = new EventQueue();
  readonly rng: RngRegistry;
  readonly trace = new TraceWriter();
  readonly catalog = new Catalog();
  readonly units = new Map<string, Unit>();
  /** Boss-mod style timer windows, keyed `${boss}|${ability}`; visible to actors (§8.6). */
  readonly timerWindows = new Map<string, TimerWindow>();
  private readonly listeners: Array<(ev: TraceEvent) => void> = [];
  private nextSampleMs = 0;
  private lastSampleMs = -1;

  constructor(readonly options: SimOptions) {
    if (!Number.isInteger(options.sampleIntervalMs) || options.sampleIntervalMs <= 0) {
      throw new Error('sampleIntervalMs must be a positive integer');
    }
    if (!Number.isInteger(options.maxDurationMs) || options.maxDurationMs <= 0) {
      throw new Error('maxDurationMs must be a positive integer');
    }
    this.rng = new RngRegistry(options.seed);
  }

  addUnit(init: UnitInit): Unit {
    if (this.units.has(init.id)) throw new Error(`duplicate unit id ${init.id}`);
    const u = createUnit(init);
    this.units.set(u.id, u);
    return u;
  }

  unit(id: string): Unit {
    const u = this.units.get(id);
    if (!u) throw new Error(`unknown unit ${id}`);
    return u;
  }

  sortedUnits(filter: (u: Unit) => boolean = () => true): Unit[] {
    return [...this.units.values()].filter(filter).sort(byId);
  }

  bosses(): Unit[] {
    return this.sortedUnits((u) => u.role === 'boss');
  }

  players(): Unit[] {
    return this.sortedUnits((u) => u.kind === 'player');
  }

  subscribe(listener: (ev: TraceEvent) => void): void {
    this.listeners.push(listener);
  }

  emit(kind: EventKind, data: Readonly<Record<string, TraceValue>>, causes: readonly string[] = []): string {
    const ev = this.trace.emit(this.now, kind, data, causes);
    for (const listener of [...this.listeners]) listener(ev);
    return ev.id;
  }

  at(timeMs: number, cls: EventClass, run: () => void): Scheduled {
    if (timeMs < this.now) throw new Error(`cannot schedule at ${timeMs} before now (${this.now})`);
    return this.queue.push(timeMs, cls, run);
  }

  cancel(item: Scheduled | null): void {
    if (item) this.queue.cancel(item);
  }

  /** Applies damage; returns the damage event id, or null if the target is dead or the fight is over. */
  damage(targetId: string, amount: number, info: HitInfo, causes: readonly string[]): string | null {
    const u = this.unit(targetId);
    if (!u.alive || this.outcome) return null;
    const rounded = Math.max(0, Math.round(amount));
    const dealt = Math.min(u.health, rounded);
    u.health -= dealt;
    const id = this.emit(
      'damage',
      { target: u.id, source: info.sourceId, ability: info.ability, school: info.school, amount: dealt, overkill: rounded - dealt },
      causes,
    );
    if (u.health <= 0) this.kill(u, id);
    return id;
  }

  /** Applies healing; a dead target is not healed and no event is written (A-008). */
  heal(targetId: string, amount: number, info: HitInfo, causes: readonly string[]): string | null {
    const u = this.unit(targetId);
    if (!u.alive || this.outcome) return null;
    const rounded = Math.max(0, Math.round(amount));
    const effective = Math.min(u.maxHealth - u.health, rounded);
    u.health += effective;
    return this.emit(
      'heal',
      { target: u.id, source: info.sourceId, ability: info.ability, amount: effective, overheal: rounded - effective },
      causes,
    );
  }

  startMove(unitId: string, to: Vec2, causes: readonly string[]): string {
    const u = this.unit(unitId);
    if (!u.alive) throw new Error(`dead unit ${unitId} cannot move`);
    if (u.speedYdPerSec <= 0) throw new Error(`unit ${unitId} cannot move (speed 0)`);
    const from = positionAt(u, this.now);
    if (u.move) this.cancel(u.move.handle);
    const arrivalMs = this.now + travelTimeMs(from, to, u.speedYdPerSec);
    let startEvent = '';
    const handle = this.at(arrivalMs, EventClass.Decision, () => {
      u.pos = to;
      u.move = null;
      this.emit('move_end', { unit: u.id, x: r3(to.x), y: r3(to.y), stopped: false }, [startEvent]);
    });
    u.pos = from;
    u.move = { from, to, startMs: this.now, speed: u.speedYdPerSec, arrivalMs, handle };
    startEvent = this.emit(
      'move_start',
      { unit: u.id, fromX: r3(from.x), fromY: r3(from.y), toX: r3(to.x), toY: r3(to.y), arrivalMs },
      causes,
    );
    return startEvent;
  }

  stopMove(unitId: string, causes: readonly string[]): string | null {
    const u = this.unit(unitId);
    if (!u.move) return null;
    const p = positionAt(u, this.now);
    this.cancel(u.move.handle);
    u.pos = p;
    u.move = null;
    return this.emit('move_end', { unit: u.id, x: r3(p.x), y: r3(p.y), stopped: true }, causes);
  }

  run(): Outcome {
    if (this.outcome) return this.outcome;
    const max = this.options.maxDurationMs;
    for (;;) {
      const next = this.queue.peek();
      const horizon = Math.min(next ? next.time : Number.POSITIVE_INFINITY, max + 1);
      while (this.nextSampleMs < horizon) {
        this.sample(this.nextSampleMs);
        this.nextSampleMs += this.options.sampleIntervalMs;
      }
      if (!next || next.time > max) {
        this.now = Math.max(this.now, max);
        this.finish('timeout', []);
        break;
      }
      this.queue.pop();
      this.now = next.time;
      next.run();
      if (this.outcome) break;
    }
    if (this.lastSampleMs !== this.now) this.sample(this.now);
    return this.outcome as unknown as Outcome;
  }

  private kill(u: Unit, cause: string): void {
    u.alive = false;
    u.health = 0;
    if (u.cast) {
      this.cancel(u.cast.handle);
      u.cast = null;
    }
    if (u.move) {
      u.pos = positionAt(u, this.now);
      this.cancel(u.move.handle);
      u.move = null;
    }
    const deathId = this.emit('death', { unit: u.id }, [cause]);
    u.diedAtEvent = deathId;
    for (const key of [...u.auras.keys()].sort(byString)) {
      const a = u.auras.get(key)!;
      this.cancel(a.expiry);
      this.cancel(a.tick);
      u.auras.delete(key);
      this.emit('aura_removed', { unit: u.id, aura: a.auraId, caster: a.casterId, reason: 'death' }, [deathId]);
    }
    this.checkOutcome(deathId);
  }

  private checkOutcome(cause: string): void {
    if (this.outcome) return;
    const bosses = this.bosses();
    const players = this.players();
    if (bosses.length > 0 && bosses.every((b) => !b.alive)) this.finish('kill', [cause]);
    else if (players.length > 0 && players.every((p) => !p.alive)) this.finish('wipe', [cause]);
  }

  private finish(kind: OutcomeKind, causes: readonly string[]): void {
    const event = this.emit('outcome', { kind }, causes);
    this.outcome = { kind, atMs: this.now, event };
  }

  private sample(t: number): void {
    const units: UnitSnapshot[] = this.sortedUnits().map((u) => {
      const p = positionAt(u, t);
      const auras = [...u.auras.values()]
        .map((a) => [a.auraId, a.stacks] as const)
        .sort((a, b) => byString(a[0], b[0]) || a[1] - b[1]);
      return { id: u.id, x: r3(p.x), y: r3(p.y), health: u.health, alive: u.alive, auras, cast: u.cast ? u.cast.spellId : null };
    });
    this.trace.snapshot({ t, units });
    this.lastSampleMs = t;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/sim.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/catalog.ts packages/engine/src/sim.ts packages/engine/test/sim.test.ts
git commit -m "feat(engine): simulation loop with sampling, damage, healing, death and outcomes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Effects and auras

**Files:**
- Create: `packages/engine/src/effects.ts`, `packages/engine/src/auras.ts`
- Test: `packages/engine/test/auras.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/auras.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const player = { kind: 'player' as const, role: 'ranged' as const, maxHealth: 5000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 3, maxDurationMs: 20000, sampleIntervalMs: 1000 });
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e6, pos: { x: 0, y: 30 }, speedYdPerSec: 7, combatReach: 5, boundingRadius: 2 });
  sim.addUnit({ ...player, id: 'p1', name: 'P1', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...player, id: 'p2', name: 'P2', pos: { x: 9.5, y: 0 } });
  sim.addUnit({ ...player, id: 'p3', name: 'P3', pos: { x: -9.49, y: 0 } });
  sim.addUnit({ ...player, id: 'p4', name: 'P4', pos: { x: 0, y: -9.51 } });
  sim.catalog.addAura({ id: 'stacker', durationMs: 10000, maxStacks: 3 });
  sim.catalog.addAura({
    id: 'dot',
    durationMs: 3000,
    maxStacks: 1,
    periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'shadow', min: 100, max: 100 }] },
  });
  sim.catalog.addAura({
    id: 'bomb',
    durationMs: 2000,
    maxStacks: 1,
    onExpire: [
      { type: 'area', radius: 8, includeCenter: true, filter: 'players', effects: [{ type: 'damage', school: 'nature', min: 1000, max: 1000 }] },
    ],
  });
  return sim;
}

const events = (sim: Simulation, kind: string) => sim.trace.list().filter((e) => e.kind === kind);

describe('auras', () => {
  it('stacks up to the maximum and refreshes the duration (A-009)', () => {
    const sim = newSim();
    for (const t of [0, 1000, 2000, 3000]) sim.at(t, EventClass.SpellHit, () => void applyAura(sim, 'stacker', 'boss', 'p1', []));
    sim.run();
    expect(events(sim, 'aura_stack').map((e) => e.data.stacks)).toEqual([2, 3, 3]);
    const removed = events(sim, 'aura_removed')[0];
    expect(removed.t).toBe(13000);
    expect(removed.data.reason).toBe('expired');
  });

  it('ticks before it expires at the same millisecond (A-001)', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'dot', 'boss', 'p1', []));
    sim.run();
    expect(events(sim, 'periodic_tick').map((e) => e.t)).toEqual([1000, 2000, 3000]);
    const at3000 = sim.trace.list().filter((e) => e.t === 3000).map((e) => e.kind);
    expect(at3000).toEqual(['periodic_tick', 'damage', 'aura_removed']);
    expect(sim.unit('p1').health).toBe(4700);
  });

  it('hits exactly the units within the area radius at expiry (boundary test)', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'bomb', 'boss', 'p1', []));
    sim.run();
    const hitIds = events(sim, 'damage').map((e) => e.data.target);
    // p2: edge distance exactly 8 (hit); p3: 7.99 (hit); p4: 8.01 (miss); p1 is the centre.
    expect(hitIds).toEqual(['p1', 'p2', 'p3']);
    const removal = events(sim, 'aura_removed')[0];
    expect(events(sim, 'damage')[0].causes).toEqual([removal.id]);
  });

  it('death at the expiry millisecond removes the aura without its on-expire effect (A-012)', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'bomb', 'boss', 'p1', []));
    sim.at(2000, EventClass.SpellHit, () => void sim.damage('p1', 1e6, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    sim.run();
    expect(events(sim, 'aura_removed')[0].data.reason).toBe('death');
    expect(events(sim, 'damage').map((e) => e.data.target)).toEqual(['p1']);
  });

  it('removeAuras removes every instance of an aura without on-expire', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'bomb', 'boss', 'p1', []);
      applyAura(sim, 'bomb', 'p2', 'p1', []);
    });
    sim.at(500, EventClass.SpellHit, () => void removeAuras(sim, 'p1', 'bomb', 'removed', []));
    sim.run();
    expect(events(sim, 'aura_removed').map((e) => e.data.caster)).toEqual(['boss', 'p2']);
    expect(events(sim, 'damage')).toHaveLength(0);
  });

  it('does not apply auras to dead units', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      sim.damage('p1', 1e6, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []);
      expect(applyAura(sim, 'stacker', 'boss', 'p1', [])).toBeNull();
    });
    sim.run();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/auras.test.ts`
Expected: FAIL, cannot resolve `../src/auras`.

- [ ] **Step 3: Write `effects.ts`**

`packages/engine/src/effects.ts`:
```ts
import { applyAura, removeAuras } from './auras';
import type { Effect } from './catalog';
import { pointToEdge, positionAt } from './movement';
import type { Simulation } from './sim';
import type { Unit } from './units';

export interface EffectContext {
  readonly casterId: string;
  readonly targetId: string;
  readonly ability: string;
  readonly causes: readonly string[];
}

function matchesFilter(filter: 'players' | 'creatures' | 'all', u: Unit): boolean {
  if (filter === 'all') return true;
  return filter === 'players' ? u.kind === 'player' : u.kind === 'creature';
}

export function applyEffects(sim: Simulation, effects: readonly Effect[], ctx: EffectContext): void {
  for (const e of effects) applyEffect(sim, e, ctx);
}

function applyEffect(sim: Simulation, e: Effect, ctx: EffectContext): void {
  const target = sim.unit(ctx.targetId);
  switch (e.type) {
    case 'damage': {
      if (!target.alive) return;
      const amount = sim.rng.stream(`unit:${ctx.casterId}.amount`).int(e.min, e.max);
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
    case 'area': {
      const center = positionAt(target, sim.now);
      const hit = sim.sortedUnits(
        (u) =>
          u.alive &&
          (e.includeCenter || u.id !== target.id) &&
          matchesFilter(e.filter, u) &&
          pointToEdge(center, u, sim.now) <= e.radius,
      );
      for (const u of hit) applyEffects(sim, e.effects, { ...ctx, targetId: u.id });
      return;
    }
  }
}
```

- [ ] **Step 4: Write `auras.ts`**

`packages/engine/src/auras.ts`:
```ts
import { applyEffects } from './effects';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import { auraKey, type AuraInstance } from './units';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Applies or stacks an aura; returns the event id, or null if the target is dead. */
export function applyAura(
  sim: Simulation,
  auraId: string,
  casterId: string,
  targetId: string,
  causes: readonly string[],
): string | null {
  const def = sim.catalog.aura(auraId);
  const target = sim.unit(targetId);
  if (!target.alive) return null;
  const key = auraKey(auraId, casterId);
  const expiresMs = sim.now + def.durationMs;
  const existing = target.auras.get(key);
  if (existing) {
    existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
    sim.cancel(existing.expiry);
    existing.expiresMs = expiresMs;
    existing.expiry = sim.at(expiresMs, EventClass.AuraExpiry, () => expire(sim, targetId, key));
    const id = sim.emit(
      'aura_stack',
      { unit: targetId, aura: auraId, caster: casterId, stacks: existing.stacks, expiresMs },
      causes,
    );
    if (def.periodic && existing.tick === null && target.auras.get(key) === existing) scheduleTick(sim, targetId, key, existing);
    return id;
  }
  const inst: AuraInstance = {
    auraId,
    casterId,
    stacks: 1,
    appliedMs: sim.now,
    expiresMs,
    expiry: sim.at(expiresMs, EventClass.AuraExpiry, () => expire(sim, targetId, key)),
    tick: null,
    appliedEvent: '',
  };
  target.auras.set(key, inst);
  inst.appliedEvent = sim.emit('aura_applied', { unit: targetId, aura: auraId, caster: casterId, stacks: 1, expiresMs }, causes);
  if (def.periodic && target.auras.get(key) === inst) scheduleTick(sim, targetId, key, inst);
  return inst.appliedEvent;
}

function scheduleTick(sim: Simulation, targetId: string, key: string, inst: AuraInstance): void {
  const periodic = sim.catalog.aura(inst.auraId).periodic;
  if (!periodic) return;
  const at = sim.now + periodic.intervalMs;
  if (at > inst.expiresMs) {
    inst.tick = null;
    return;
  }
  inst.tick = sim.at(at, EventClass.PeriodicTick, () => {
    inst.tick = null;
    const target = sim.unit(targetId);
    if (target.auras.get(key) !== inst) return;
    const tickId = sim.emit(
      'periodic_tick',
      { unit: targetId, aura: inst.auraId, caster: inst.casterId, stacks: inst.stacks },
      [inst.appliedEvent],
    );
    applyEffects(sim, periodic.effects, { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [tickId] });
    if (target.auras.get(key) === inst) scheduleTick(sim, targetId, key, inst);
  });
}

function expire(sim: Simulation, targetId: string, key: string): void {
  const target = sim.unit(targetId);
  const inst = target.auras.get(key);
  if (!inst) return;
  sim.cancel(inst.tick);
  target.auras.delete(key);
  const removed = sim.emit(
    'aura_removed',
    { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason: 'expired' },
    [inst.appliedEvent],
  );
  const onExpire = sim.catalog.aura(inst.auraId).onExpire;
  if (onExpire) applyEffects(sim, onExpire, { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [removed] });
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
  for (const key of [...target.auras.keys()].sort(byString)) {
    const inst = target.auras.get(key)!;
    if (inst.auraId !== auraId) continue;
    sim.cancel(inst.expiry);
    sim.cancel(inst.tick);
    target.auras.delete(key);
    ids.push(sim.emit('aura_removed', { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason }, causes));
  }
  return ids;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/auras.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/effects.ts packages/engine/src/auras.ts packages/engine/test/auras.test.ts
git commit -m "feat(engine): effects and auras with stacking, ticks, expiry and area effects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Casting

**Files:**
- Create: `packages/engine/src/casting.ts`
- Test: `packages/engine/test/casting.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/casting.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { checkCast, installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const dmg = (n: number) => [{ type: 'damage' as const, school: 'fire' as const, min: n, max: n }];

function newSim() {
  const sim = new Simulation({ seed: 5, maxDurationMs: 20000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  const body = { kind: 'creature' as const, maxHealth: 100000, speedYdPerSec: 7, combatReach: 0, boundingRadius: 0 };
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', role: 'boss', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'add', name: 'Add', role: 'add', pos: { x: 0, y: 5 } });
  sim.addUnit({ ...body, id: 'mage', name: 'Mage', kind: 'player', role: 'ranged', maxHealth: 1000, pos: { x: 20, y: 0 } });
  sim.catalog.addSpell({ id: 'bolt', castTimeMs: 2000, gcdMs: 1500, cooldownMs: 0, rangeYd: 30, usableWhileMoving: false, target: 'unit', effects: dmg(100) });
  sim.catalog.addSpell({ id: 'zap', castTimeMs: 0, gcdMs: 1500, cooldownMs: 6000, rangeYd: 30, usableWhileMoving: true, target: 'unit', effects: dmg(50) });
  sim.catalog.addSpell({ id: 'arrow', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 40, usableWhileMoving: true, target: 'unit', travelSpeedYdPerSec: 40, effects: dmg(10) });
  return sim;
}

const of = (sim: Simulation, kind: string) => sim.trace.list().filter((e) => e.kind === kind);

describe('casting', () => {
  it('a cast-time spell hits at completion; GCD starts at cast start', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => {
      expect(startCast(sim, 'mage', 'bolt', 'boss', []).ok).toBe(true);
      expect(sim.unit('mage').gcdUntilMs).toBe(1500);
    });
    sim.run();
    expect(of(sim, 'spell_hit').map((e) => e.t)).toEqual([2000]);
    expect(sim.unit('boss').health).toBe(99900);
  });

  it('GCD blocks the next GCD spell until it ends', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => {
      startCast(sim, 'mage', 'zap', 'boss', []);
      expect(checkCast(sim, 'mage', 'bolt', 'boss')).toEqual({ ok: false, reason: 'gcd' });
    });
    sim.at(1500, EventClass.Decision, () => expect(checkCast(sim, 'mage', 'bolt', 'boss')).toEqual({ ok: true }));
    sim.run();
  });

  it('cooldown starts when the cast succeeds', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'zap', 'boss', []));
    sim.at(5999, EventClass.Decision, () => expect(checkCast(sim, 'mage', 'zap', 'boss')).toEqual({ ok: false, reason: 'cooldown' }));
    sim.at(6000, EventClass.Decision, () => expect(checkCast(sim, 'mage', 'zap', 'boss')).toEqual({ ok: true }));
    sim.run();
  });

  it('moving interrupts a cast that is not usable while moving (boundary test)', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'bolt', 'boss', []));
    sim.at(1000, EventClass.Decision, () => void sim.startMove('mage', { x: 25, y: 0 }, []));
    sim.run();
    const interrupted = of(sim, 'cast_interrupted');
    expect(interrupted.map((e) => [e.t, e.data.reason])).toEqual([[1000, 'moved']]);
    expect(of(sim, 'spell_hit')).toHaveLength(0);
  });

  it('a cast-time spell cannot start while moving; an instant can', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => {
      sim.startMove('mage', { x: 25, y: 0 }, []);
      expect(checkCast(sim, 'mage', 'bolt', 'boss')).toEqual({ ok: false, reason: 'moving' });
      expect(checkCast(sim, 'mage', 'zap', 'boss')).toEqual({ ok: true });
    });
    sim.run();
  });

  it('range is checked again at completion', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'bolt', 'boss', []));
    sim.at(500, EventClass.Decision, () => void sim.startMove('boss', { x: -20, y: 0 }, []));
    sim.run();
    // At 2000 the boss has moved 10.5 yd: distance 30.5 > 30.
    expect(of(sim, 'cast_failed').map((e) => [e.t, e.data.reason])).toEqual([[2000, 'out_of_range']]);
  });

  it('travel time delays the hit', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'arrow', 'boss', []));
    sim.run();
    expect(of(sim, 'cast_success').map((e) => e.t)).toEqual([0]);
    expect(of(sim, 'spell_hit').map((e) => e.t)).toEqual([500]);
  });

  it('fails at completion when the target died during the cast', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'mage', 'bolt', 'add', []));
    sim.at(1000, EventClass.SpellHit, () => void sim.damage('add', 1e6, { sourceId: 'boss', ability: 'x', school: 'physical' }, []));
    sim.run();
    expect(of(sim, 'cast_failed').map((e) => e.data.reason)).toEqual(['target_dead']);
  });

  it('writes cast_failed with the reason when a cast cannot start', () => {
    const sim = newSim();
    sim.at(0, EventClass.Decision, () => {
      const r = startCast(sim, 'mage', 'nope', 'boss', []);
      expect(r).toMatchObject({ ok: false, reason: 'unknown_spell' });
    });
    sim.run();
    expect(of(sim, 'cast_failed')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/casting.test.ts`
Expected: FAIL, cannot resolve `../src/casting`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/casting.ts`:
```ts
import type { SpellDef } from './catalog';
import { applyEffects } from './effects';
import { edgeDistance, positionAt, travelTimeMs } from './movement';
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
  | 'out_of_range';

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

export function startCast(
  sim: Simulation,
  casterId: string,
  spellId: string,
  targetId: string,
  causes: readonly string[],
): CastResult {
  const check = checkCast(sim, casterId, spellId, targetId);
  if (!check.ok) {
    const event = sim.emit('cast_failed', { caster: casterId, spell: spellId, target: targetId, reason: check.reason }, causes);
    return { ok: false, reason: check.reason, event };
  }
  const spell = sim.catalog.spell(spellId);
  const caster = sim.unit(casterId);
  const tId = resolveTarget(spell, casterId, targetId);
  if (spell.gcdMs > 0) caster.gcdUntilMs = sim.now + spell.gcdMs;
  if (spell.castTimeMs === 0) {
    const event = sim.emit('cast_start', { caster: casterId, spell: spellId, target: tId, castTimeMs: 0, endMs: sim.now }, causes);
    complete(sim, caster, spell, tId, event);
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
      complete(sim, caster, spell, tId, cast.startEvent);
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

function complete(sim: Simulation, caster: Unit, spell: SpellDef, targetId: string, startEvent: string): void {
  if (!caster.alive) return;
  const target = sim.unit(targetId);
  if (!target.alive) {
    sim.emit('cast_failed', { caster: caster.id, spell: spell.id, target: targetId, reason: 'target_dead' }, [startEvent]);
    return;
  }
  if (target.id !== caster.id && edgeDistance(caster, target, sim.now) > spell.rangeYd) {
    sim.emit('cast_failed', { caster: caster.id, spell: spell.id, target: targetId, reason: 'out_of_range' }, [startEvent]);
    return;
  }
  if (spell.cooldownMs > 0) caster.cooldowns.set(spell.id, sim.now + spell.cooldownMs);
  const success = sim.emit('cast_success', { caster: caster.id, spell: spell.id, target: targetId }, [startEvent]);
  if (spell.travelSpeedYdPerSec && target.id !== caster.id) {
    const delay = travelTimeMs(positionAt(caster, sim.now), positionAt(target, sim.now), spell.travelSpeedYdPerSec);
    sim.at(sim.now + delay, EventClass.SpellHit, () => hit(sim, caster.id, spell, targetId, success));
  } else {
    hit(sim, caster.id, spell, targetId, success);
  }
}

function hit(sim: Simulation, casterId: string, spell: SpellDef, targetId: string, cause: string): void {
  if (!sim.unit(targetId).alive) return;
  const hitId = sim.emit('spell_hit', { caster: casterId, spell: spell.id, target: targetId }, [cause]);
  applyEffects(sim, spell.effects, { casterId, targetId, ability: spell.id, causes: [hitId] });
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/casting.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/casting.ts packages/engine/test/casting.test.ts
git commit -m "feat(engine): casting with GCD, cooldowns, movement interruption, range recheck and travel time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Boss AI with AzerothCore update semantics

`EventScriptedAI.updateAI` follows the shape of `boss_festergutAI::UpdateAI` at the pinned commit: return without a victim, advance the EventMap, return while casting, then execute at most one due event.

**Files:**
- Create: `packages/engine/src/boss.ts`
- Test: `packages/engine/test/boss.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/boss.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { EventScriptedAI, attachBoss, victimOf, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { Simulation } from '../src/sim';

class TestAI extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [
    { key: 'test.channel', status: 'implemented', omissions: [], validation: 'unvalidated' },
  ];
  protected engage(_ctx: BossContext): void {
    this.events.schedule(1, 1000);
    this.events.schedule(2, 1500);
    this.events.schedule(3, 2500);
  }
  protected executeEvent(id: number, ctx: BossContext): void {
    const ev = ctx.ai(`event_${id}`);
    if (id === 1) ctx.cast('channel', ctx.self.id, [ev]);
  }
}

function newSim(withVictim = true) {
  const sim = new Simulation({ seed: 11, maxDurationMs: 5000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e6, pos: { x: 0, y: 0 }, speedYdPerSec: 7, combatReach: 5, boundingRadius: 2 });
  for (const id of ['p1', 'p2', 'p3']) {
    sim.addUnit({ id, name: id, kind: 'player', role: 'ranged', maxHealth: 1000, pos: { x: 10, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  }
  if (withVictim) sim.unit('boss').threat.set('p1', 100);
  sim.catalog.addSpell({ id: 'channel', castTimeMs: 2000, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: false, target: 'self', effects: [] });
  return sim;
}

const aiEvents = (sim: Simulation) =>
  sim.trace
    .list()
    .filter((e) => e.kind === 'ai_event')
    .map((e) => [e.t, e.data.event]);

describe('boss AI (§5.1)', () => {
  it('timers advance while casting, nothing executes while casting, one event per update', () => {
    const sim = newSim();
    attachBoss(sim, new TestAI(), 'boss', 10);
    sim.run();
    expect(aiEvents(sim)).toEqual([
      [1000, 'event_1'],
      [3000, 'event_2'],
      [3010, 'event_3'],
    ]);
  });

  it('does nothing without a victim', () => {
    const sim = newSim(false);
    attachBoss(sim, new TestAI(), 'boss', 10);
    sim.run();
    expect(aiEvents(sim)).toEqual([]);
  });

  it('picks the victim by highest threat, ties by id, skipping the dead', () => {
    const sim = newSim(false);
    const boss = sim.unit('boss');
    boss.threat.set('p3', 50);
    boss.threat.set('p2', 50);
    expect(victimOf(sim, 'boss')?.id).toBe('p2');
    sim.unit('p2').alive = false;
    expect(victimOf(sim, 'boss')?.id).toBe('p3');
  });

  it('publishes timer windows and uses one random stream per mechanic', () => {
    const sim = newSim();
    const holder: { ctx: BossContext | null } = { ctx: null };
    class Probe extends TestAI {
      protected engage(ctx: BossContext): void {
        holder.ctx = ctx;
      }
    }
    attachBoss(sim, new Probe(), 'boss', 10);
    const ctx = holder.ctx!;
    ctx.publishTimer('gas_spore', 20000, 25000, []);
    expect(sim.timerWindows.get('boss|gas_spore')).toEqual({ boss: 'boss', ability: 'gas_spore', earliestMs: 20000, latestMs: 25000 });
    const picked = ctx.pick('gas_spore', sim.players(), 2).map((u) => u.id);
    const expected = new Simulation({ seed: 11, maxDurationMs: 1, sampleIntervalMs: 1 }).rng
      .stream('boss:boss.gas_spore')
      .pick(sim.players(), 2)
      .map((u) => u.id);
    expect(picked).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/boss.test.ts`
Expected: FAIL, cannot resolve `../src/boss`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/boss.ts`:
```ts
import { startCast, type CastResult } from './casting';
import { EventMap } from './eventmap';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import type { TraceValue } from './trace';
import type { Unit } from './units';

export type MechanicStatusKind = 'implemented' | 'partial' | 'not_implemented';
export type ValidationStatus = 'unvalidated' | 'azerothcore_source' | 'rising_gods_logs';

/** Spec §6.1: mechanics status and validation status are reported separately. */
export interface MechanicStatus {
  readonly key: string;
  readonly status: MechanicStatusKind;
  readonly omissions: readonly string[];
  readonly validation: ValidationStatus;
  readonly logRef?: string;
}

export interface BossContext {
  readonly sim: Simulation;
  readonly self: Unit;
  victim(): Unit | null;
  ai(name: string, data?: Readonly<Record<string, TraceValue>>, causes?: readonly string[]): string;
  cast(spellId: string, targetId: string, causes: readonly string[]): CastResult;
  /** Picks targets from the stream `boss:<bossId>.<mechanic>` (§8.7). */
  pick(mechanic: string, candidates: readonly Unit[], n: number): Unit[];
  publishTimer(ability: string, minMs: number, maxMs: number, causes: readonly string[]): string;
  setPhase(phase: string, causes: readonly string[]): string;
}

export interface BossScript {
  readonly bossId: string;
  readonly mechanics: readonly MechanicStatus[];
  /** Known differences from Rising-Gods that are not modelled (§6.4). */
  readonly knownServerDifferences: readonly string[];
  onEngage(ctx: BossContext): void;
  updateAI(ctx: BossContext, diffMs: number): void;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Highest threat among living units on the boss's threat table; ties go to the lowest id. */
export function victimOf(sim: Simulation, bossId: string): Unit | null {
  const boss = sim.unit(bossId);
  let best: Unit | null = null;
  let bestThreat = Number.NEGATIVE_INFINITY;
  for (const id of [...boss.threat.keys()].sort(byString)) {
    const u = sim.units.get(id);
    const threat = boss.threat.get(id)!;
    if (!u || !u.alive) continue;
    if (threat > bestThreat) {
      best = u;
      bestThreat = threat;
    }
  }
  return best;
}

/** Base for scripts written like AzerothCore's EventMap-driven boss AIs. */
export abstract class EventScriptedAI implements BossScript {
  abstract readonly bossId: string;
  abstract readonly mechanics: readonly MechanicStatus[];
  readonly knownServerDifferences: readonly string[] = [];
  protected events!: EventMap;

  onEngage(ctx: BossContext): void {
    this.events = new EventMap(ctx.sim.rng.stream(`boss:${this.bossId}.timers`));
    this.engage(ctx);
  }

  updateAI(ctx: BossContext, diffMs: number): void {
    if (!ctx.victim()) return;
    this.events.update(diffMs);
    if (ctx.self.cast) return;
    const id = this.events.execute();
    if (id !== 0) this.executeEvent(id, ctx);
  }

  protected abstract engage(ctx: BossContext): void;
  protected abstract executeEvent(eventId: number, ctx: BossContext): void;
}

export function makeBossContext(sim: Simulation, bossId: string): BossContext {
  const self = sim.unit(bossId);
  return {
    sim,
    self,
    victim: () => victimOf(sim, bossId),
    ai: (name, data = {}, causes = []) => sim.emit('ai_event', { ...data, boss: bossId, event: name }, causes),
    cast: (spellId, targetId, causes) => startCast(sim, bossId, spellId, targetId, causes),
    pick: (mechanic, candidates, n) => sim.rng.stream(`boss:${bossId}.${mechanic}`).pick(candidates, n),
    publishTimer: (ability, minMs, maxMs, causes) => {
      const w = { boss: bossId, ability, earliestMs: sim.now + minMs, latestMs: sim.now + maxMs };
      sim.timerWindows.set(`${bossId}|${ability}`, w);
      return sim.emit('timer_window', { ...w }, causes);
    },
    setPhase: (phase, causes) => {
      sim.phase = phase;
      return sim.emit('phase_change', { boss: bossId, phase }, causes);
    },
  };
}

/** Emits engage, calls onEngage, and runs updateAI every intervalMs (A-002). Returns the engage event id. */
export function attachBoss(sim: Simulation, script: BossScript, bossUnitId: string, intervalMs: number): string {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) throw new Error('AI update interval must be a positive integer');
  const ctx = makeBossContext(sim, bossUnitId);
  const engage = sim.emit('engage', { boss: bossUnitId });
  script.onEngage(ctx);
  const tick = (): void => {
    if (!ctx.self.alive || sim.outcome) return;
    script.updateAI(ctx, intervalMs);
    sim.at(sim.now + intervalMs, EventClass.AiUpdate, tick);
  };
  sim.at(sim.now + intervalMs, EventClass.AiUpdate, tick);
  return engage;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/boss.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/boss.ts packages/engine/test/boss.test.ts
git commit -m "feat(engine): boss AI base with AzerothCore update semantics, timer windows and per-mechanic streams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Actor view and policy controller

`ActorView` is the only thing a policy receives (§8.6): frozen copies of what a player could see, the plan's spots and assignment, boss-mod timer windows, and a `canCast` check. It never exposes the event queue, an `EventMap`, or another actor's random streams.

**Files:**
- Create: `packages/engine/src/view.ts`, `packages/engine/src/controller.ts`
- Test: `packages/engine/test/controller.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/controller.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { installCoreRules } from '../src/casting';
import { ActorController, type ActorPolicy, type ControllerHooks } from '../src/controller';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import type { ActorView } from '../src/view';

const dmg = (n: number) => [{ type: 'damage' as const, school: 'fire' as const, min: n, max: n }];
const hooks = (ruleMoving = false): ControllerHooks => ({
  isRuleMoving: () => ruleMoving,
  spots: () => ({ home: { x: 1, y: 2 } }),
  assignment: () => 'home',
});

function newSim(maxDurationMs = 5000) {
  const sim = new Simulation({ seed: 2, maxDurationMs, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  const body = { maxHealth: 10000, speedYdPerSec: 7, combatReach: 0, boundingRadius: 0 };
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1000000, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'mage', name: 'Mage', kind: 'player', role: 'ranged', pos: { x: 20, y: 0 } });
  sim.addUnit({ ...body, id: 'healer', name: 'Healer', kind: 'player', role: 'healer', pos: { x: 25, y: 0 } });
  sim.addUnit({ ...body, id: 'tank', name: 'Tank', kind: 'player', role: 'tank', pos: { x: 2, y: 0 } });
  sim.catalog.addSpell({ id: 'bolt', castTimeMs: 1500, gcdMs: 1500, cooldownMs: 0, rangeYd: 30, usableWhileMoving: false, target: 'unit', effects: dmg(100) });
  sim.catalog.addSpell({ id: 'flash', castTimeMs: 0, gcdMs: 0, cooldownMs: 10000, rangeYd: 30, usableWhileMoving: true, target: 'unit', effects: dmg(10) });
  sim.catalog.addSpell({ id: 'mend', castTimeMs: 0, gcdMs: 1500, cooldownMs: 0, rangeYd: 40, usableWhileMoving: true, target: 'unit', effects: [{ type: 'heal', min: 200, max: 200 }] });
  sim.catalog.addAura({ id: 'mark', durationMs: 4000, maxStacks: 1 });
  return sim;
}

const casterPolicy: ActorPolicy = {
  wakeOn: { anyHealthChange: false, anyAuraChange: false },
  decide: (v) =>
    v.canCast('flash', 'boss').ok
      ? { type: 'cast', spell: 'flash', target: 'boss' }
      : v.canCast('bolt', 'boss').ok
        ? { type: 'cast', spell: 'bolt', target: 'boss' }
        : { type: 'none' },
};

const healerPolicy: ActorPolicy = {
  wakeOn: { anyHealthChange: true, anyAuraChange: false },
  decide: (v) => {
    const hurt = v.units
      .filter((u) => u.kind === 'player' && u.alive && u.health < u.maxHealth)
      .sort((a, b) => a.health / a.maxHealth - b.health / b.maxHealth);
    const t = hurt[0];
    return t && v.canCast('mend', t.id).ok ? { type: 'cast', spell: 'mend', target: t.id } : { type: 'none' };
  },
};

describe('ActorController (§8.4)', () => {
  it('casts back to back and uses an off-GCD ability in the same wake-up', () => {
    const sim = newSim();
    new ActorController(sim, 'mage', casterPolicy, hooks()).install();
    sim.run();
    const casts = sim.trace
      .list()
      .filter((e) => e.kind === 'cast_start' && e.data.caster === 'mage')
      .map((e) => [e.t, e.data.spell]);
    expect(casts).toEqual([
      [0, 'flash'],
      [0, 'bolt'],
      [1500, 'bolt'],
      [3000, 'bolt'],
      [4500, 'bolt'],
    ]);
  });

  it('a healer wakes on damage to someone else and heals the lowest player', () => {
    const sim = newSim();
    new ActorController(sim, 'healer', healerPolicy, hooks()).install();
    sim.at(2000, EventClass.SpellHit, () => void sim.damage('tank', 300, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    sim.run();
    const heals = sim.trace
      .list()
      .filter((e) => e.kind === 'heal')
      .map((e) => [e.t, e.data.target, e.data.amount]);
    expect(heals).toEqual([
      [2000, 'tank', 200],
      [3500, 'tank', 100],
    ]);
  });

  it('the view holds frozen copies of visible state only (§8.6)', () => {
    const sim = newSim(1000);
    const views: ActorView[] = [];
    const probe: ActorPolicy = { wakeOn: { anyHealthChange: false, anyAuraChange: false }, decide: (v) => (views.push(v), { type: 'none' }) };
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'mark', 'boss', 'mage', []));
    new ActorController(sim, 'mage', probe, hooks()).install();
    sim.run();
    const v = views[0];
    expect(Object.keys(v).sort()).toEqual([
      'assignment',
      'canCast',
      'cooldownReadyAtMs',
      'gcdReadyAtMs',
      'now',
      'self',
      'spots',
      'timers',
      'units',
    ]);
    expect(v.self.auras).toEqual([{ aura: 'mark', caster: 'boss', stacks: 1, remainingMs: 4000 }]);
    expect(Object.keys(v.self).sort()).toEqual([
      'alive', 'auras', 'cast', 'combatReach', 'health', 'id', 'kind', 'maxHealth', 'moving', 'name', 'role', 'x', 'y',
    ]);
    expect(() => {
      (v.self as { health: number }).health = 1;
    }).toThrow(TypeError);
    expect(v.assignment).toBe('home');
  });

  it('policy moves are ignored while a plan rule move is running', () => {
    for (const ruleMoving of [true, false]) {
      const sim = newSim(1000);
      const mover: ActorPolicy = { wakeOn: { anyHealthChange: false, anyAuraChange: false }, decide: () => ({ type: 'move', to: { x: 30, y: 0 } }) };
      new ActorController(sim, 'mage', mover, hooks(ruleMoving)).install();
      sim.run();
      expect(sim.trace.list().some((e) => e.kind === 'move_start')).toBe(!ruleMoving);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/controller.test.ts`
Expected: FAIL, cannot resolve `../src/controller`.

- [ ] **Step 3: Write `view.ts`**

`packages/engine/src/view.ts`:
```ts
import { checkCast, type CastCheck } from './casting';
import { positionAt } from './movement';
import type { Simulation, TimerWindow } from './sim';
import type { Role, Unit, Vec2 } from './units';

export interface AuraView {
  readonly aura: string;
  readonly caster: string;
  readonly stacks: number;
  readonly remainingMs: number;
}

export interface CastView {
  readonly spell: string;
  readonly target: string;
  readonly endsAtMs: number;
}

export interface UnitView {
  readonly id: string;
  readonly name: string;
  readonly kind: 'player' | 'creature';
  readonly role: Role;
  readonly health: number;
  readonly maxHealth: number;
  readonly alive: boolean;
  readonly x: number;
  readonly y: number;
  readonly moving: boolean;
  readonly combatReach: number;
  readonly auras: readonly AuraView[];
  readonly cast: CastView | null;
}

/** Everything an actor may know (§8.6). */
export interface ActorView {
  readonly now: number;
  readonly self: UnitView;
  readonly units: readonly UnitView[];
  readonly spots: Readonly<Record<string, Vec2>>;
  readonly assignment: string | null;
  readonly timers: readonly TimerWindow[];
  readonly gcdReadyAtMs: number;
  readonly cooldownReadyAtMs: Readonly<Record<string, number>>;
  canCast(spellId: string, targetId: string): CastCheck;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function unitView(u: Unit, now: number): UnitView {
  const p = positionAt(u, now);
  const auras = [...u.auras.values()]
    .map((a) => Object.freeze({ aura: a.auraId, caster: a.casterId, stacks: a.stacks, remainingMs: a.expiresMs - now }))
    .sort((a, b) => byString(a.aura, b.aura) || byString(a.caster, b.caster));
  return Object.freeze({
    id: u.id,
    name: u.name,
    kind: u.kind,
    role: u.role,
    health: u.health,
    maxHealth: u.maxHealth,
    alive: u.alive,
    x: p.x,
    y: p.y,
    moving: u.move !== null,
    combatReach: u.combatReach,
    auras: Object.freeze(auras),
    cast: u.cast ? Object.freeze({ spell: u.cast.spellId, target: u.cast.targetId, endsAtMs: u.cast.endMs }) : null,
  });
}

export function buildView(
  sim: Simulation,
  selfId: string,
  spots: Readonly<Record<string, Vec2>>,
  assignment: string | null,
): ActorView {
  const now = sim.now;
  const units = sim.sortedUnits().map((u) => unitView(u, now));
  const self = units.find((u) => u.id === selfId);
  if (!self) throw new Error(`unknown actor ${selfId}`);
  const me = sim.unit(selfId);
  const cooldowns: Record<string, number> = {};
  for (const id of [...me.cooldowns.keys()].sort(byString)) cooldowns[id] = me.cooldowns.get(id)!;
  const timers = [...sim.timerWindows.values()]
    .sort((a, b) => byString(a.boss, b.boss) || byString(a.ability, b.ability))
    .map((t) => Object.freeze({ ...t }));
  return Object.freeze({
    now,
    self,
    units: Object.freeze(units),
    spots: Object.freeze({ ...spots }),
    assignment,
    timers: Object.freeze(timers),
    gcdReadyAtMs: me.gcdUntilMs,
    cooldownReadyAtMs: Object.freeze(cooldowns),
    canCast: (spellId: string, targetId: string) => checkCast(sim, selfId, spellId, targetId),
  });
}
```

- [ ] **Step 4: Write `controller.ts`**

`packages/engine/src/controller.ts`:
```ts
import { startCast } from './casting';
import { positionAt } from './movement';
import { EventClass, type Scheduled } from './queue';
import type { Simulation } from './sim';
import type { TraceEvent } from './trace';
import type { Unit, Vec2 } from './units';
import { buildView, type ActorView } from './view';

export type PolicyAction =
  | { readonly type: 'cast'; readonly spell: string; readonly target: string }
  | { readonly type: 'move'; readonly to: Vec2 }
  | { readonly type: 'none' };

/** A spec's decision policy (priority list, healer targeting). Plan 3 adds the real specs. */
export interface ActorPolicy {
  readonly wakeOn: { readonly anyHealthChange: boolean; readonly anyAuraChange: boolean };
  decide(view: ActorView): PolicyAction;
}

export interface ControllerHooks {
  isRuleMoving(actorId: string): boolean;
  spots(): Readonly<Record<string, Vec2>>;
  assignment(actorId: string): string | null;
}

/** Bound on actions in one wake-up; only off-GCD instants can chain. */
const MAX_ACTIONS_PER_WAKE = 4;

export class ActorController {
  private pending: Scheduled | null = null;
  private pendingAt = Number.POSITIVE_INFINITY;
  private deciding = false;

  constructor(
    private readonly sim: Simulation,
    readonly actorId: string,
    private readonly policy: ActorPolicy,
    private readonly hooks: ControllerHooks,
  ) {}

  install(): void {
    this.sim.subscribe((ev) => this.onEvent(ev));
    this.wake(this.sim.now);
  }

  /** Schedules a decision at `at` unless one is already due at or before it. */
  wake(at: number): void {
    if (this.pending && this.pendingAt <= at) return;
    if (this.pending) this.sim.cancel(this.pending);
    this.pendingAt = at;
    this.pending = this.sim.at(at, EventClass.Decision, () => {
      this.pending = null;
      this.pendingAt = Number.POSITIVE_INFINITY;
      this.decide();
    });
  }

  private onEvent(ev: TraceEvent): void {
    if (this.deciding || this.sim.outcome) return;
    if (!this.sim.unit(this.actorId).alive) return;
    const d = ev.data;
    switch (ev.kind) {
      case 'cast_success':
      case 'cast_failed':
        if (d.caster === this.actorId) this.wake(this.sim.now);
        return;
      case 'cast_interrupted':
      case 'move_end':
        if (d.unit === this.actorId) this.wake(this.sim.now);
        return;
      case 'aura_applied':
      case 'aura_stack':
      case 'aura_removed':
        if (d.unit === this.actorId || this.policy.wakeOn.anyAuraChange) this.wake(this.sim.now);
        return;
      case 'damage':
      case 'heal':
        if (d.target === this.actorId || this.policy.wakeOn.anyHealthChange) this.wake(this.sim.now);
        return;
      default:
        return;
    }
  }

  private decide(): void {
    const self = this.sim.unit(this.actorId);
    if (!self.alive || this.sim.outcome) return;
    this.deciding = true;
    try {
      for (let i = 0; i < MAX_ACTIONS_PER_WAKE; i++) {
        if (self.cast) break;
        const view = buildView(this.sim, this.actorId, this.hooks.spots(), this.hooks.assignment(this.actorId));
        const action = this.policy.decide(view);
        if (action.type === 'none') break;
        if (action.type === 'move') {
          const here = positionAt(self, this.sim.now);
          const already = here.x === action.to.x && here.y === action.to.y;
          // Moving to the current position would arrive at once and wake the actor again in the same millisecond.
          if (!already && !this.hooks.isRuleMoving(this.actorId)) this.sim.startMove(this.actorId, action.to, []);
          break;
        }
        const gcdBefore = self.gcdUntilMs;
        const result = startCast(this.sim, this.actorId, action.spell, action.target, []);
        if (!result.ok) break;
        const offGcdInstant = self.gcdUntilMs === gcdBefore && !self.cast;
        if (!offGcdInstant) break;
      }
    } finally {
      this.deciding = false;
    }
    this.scheduleFollowUp(self);
  }

  /** Wake again when the GCD or a cooldown ends; a running cast wakes the actor through cast_success. */
  private scheduleFollowUp(self: Unit): void {
    if (self.cast) return;
    const times = [self.gcdUntilMs, ...self.cooldowns.values()].filter((t) => t > this.sim.now);
    if (times.length > 0) this.wake(Math.min(...times));
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/controller.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/view.ts packages/engine/src/controller.ts packages/engine/test/controller.test.ts
git commit -m "feat(engine): actor view limited to visible state and policy controller with wake-ups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Plan and scenario schemas, validation, mistakes

**Files:**
- Create: `packages/engine/src/plan/schema.ts`, `packages/engine/src/plan/validate.ts`, `packages/engine/src/plan/mistakes.ts`, `packages/engine/src/plan/prepare.ts`
- Test: `packages/engine/test/plan.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/plan.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyMistakes } from '../src/plan/mistakes';
import { parsePlan, parseScenario, prepareRun } from '../src/plan/prepare';

const PLAN = `
id: test-plan
boss: dummy
roster:
  - { id: t1, name: Tank, kind: standin, role: tank, maxHealth: 40000, ratePerSecond: 500, reaction: { minMs: 300, maxMs: 300 } }
  - { id: p1, name: Alice, kind: modelled, spec: test_caster, profile: default, reaction: { minMs: 300, maxMs: 500 } }
  - { id: p2, name: Bob, kind: modelled, spec: test_caster, profile: default, reaction: { minMs: 300, maxMs: 500 } }
spots:
  tank: { x: 6, y: 0 }
  ranged: { x: 20, y: 0 }
  far: { x: 50, y: 0 }
phases:
  - phase: default
    assignments: { t1: tank, p1: ranged, p2: ranged }
rules:
  - id: run
    who: [p1, p2]
    when: { on: aura_applied, aura: mark, target: self }
    do: { do: move_to, spot: far }
  - id: swap
    who: [p1]
    when: { on: aura_stacks, aura: bloat, target: current_tank, atLeast: 9 }
    do: { do: taunt, target: boss }
    priority: 90
`;

const SCENARIO = `
id: test-scenario
plan: test-plan.yaml
difficulty: 25n
seed: 1
maxDurationMs: 60000
mistakes:
  - { type: exclude_from_rule, rule: run, player: p2 }
  - { type: set_stack_threshold, rule: swap, atLeast: 12 }
  - { type: reaction, player: p1, minMs: 1000, maxMs: 1500 }
observation:
  text: scenario.test.observation
  checks:
    - { check: outcome_is, outcome: timeout }
`;

function parsed() {
  const plan = parsePlan('plan.yaml', PLAN);
  const scenario = parseScenario('scenario.yaml', SCENARIO);
  if (!plan.ok || !scenario.ok) throw new Error('fixture must parse');
  return { plan: plan.value, scenario: scenario.value };
}

describe('plan and scenario parsing', () => {
  it('applies defaults', () => {
    const { plan, scenario } = parsed();
    expect(plan.rules[0]).toMatchObject({ priority: 50, mode: 'edge', cooldownMs: 0 });
    expect(scenario.profile).toBe('azerothcore');
    expect(scenario.annotations).toEqual([]);
  });

  it('reports YAML syntax errors with the file', () => {
    const r = parsePlan('broken.yaml', 'id: [unclosed');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toMatchObject({ file: 'broken.yaml', path: '(yaml)' });
  });

  it('reports schema errors with their path', () => {
    const r = parsePlan('plan.yaml', PLAN.replace('id: t1,', 'id: T1,'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((p) => p.path)).toContain('roster.0.id');
  });

  it('rejects unknown trigger kinds', () => {
    const r = parsePlan('plan.yaml', PLAN.replace('on: aura_applied', 'on: aura_maybe'));
    expect(r.ok).toBe(false);
  });
});

describe('cross validation', () => {
  it('accepts a consistent plan and scenario', () => {
    const { plan, scenario } = parsed();
    expect(prepareRun({ plan, planFile: 'plan.yaml', scenario, scenarioFile: 'scenario.yaml' }).ok).toBe(true);
  });

  it('finds broken references', () => {
    const { plan, scenario } = parsed();
    const badPlan = structuredClone(plan);
    badPlan.phases[0].assignments.p1 = 'nowhere';
    delete badPlan.phases[0].assignments.p2;
    badPlan.rules[0].who.push('ghost');
    const badScenario = structuredClone(scenario);
    badScenario.mistakes.push({ type: 'disable_rule', rule: 'nope' });
    badScenario.mistakes.push({ type: 'exclude_from_rule', rule: 'swap', player: 'p2' });
    badScenario.mistakes.push({ type: 'set_stack_threshold', rule: 'run', atLeast: 3 });
    badScenario.mistakes.push({ type: 'reaction', player: 'p1', minMs: 900, maxMs: 100 });
    const r = prepareRun({ plan: badPlan, planFile: 'plan.yaml', scenario: badScenario, scenarioFile: 'scenario.yaml' });
    expect(r.ok).toBe(false);
    const messages = r.ok ? [] : r.problems.map((p) => p.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'unknown spot nowhere',
        'p2 has no assignment in phase default',
        'unknown roster id ghost',
        'unknown rule nope',
        'p2 is not in rule swap',
        'rule run has no aura_stacks trigger',
        'minMs must not exceed maxMs',
      ]),
    );
  });

  it('rejects reserved ids in the roster', () => {
    const r = parsePlan('plan.yaml', PLAN.replace('id: p2,', 'id: boss,').replace('p2: ranged', 'boss: ranged').replace('[p1, p2]', '[p1, boss]'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { scenario } = parsed();
    scenario.mistakes = [];
    const prepared = prepareRun({ plan: r.value, planFile: 'plan.yaml', scenario, scenarioFile: 's.yaml' });
    expect(prepared.ok ? [] : prepared.problems.map((p) => p.message)).toContain('boss is reserved');
  });
});

describe('mistakes', () => {
  it('produces the effective plan without changing the base plan', () => {
    const { plan, scenario } = parsed();
    const before = JSON.stringify(plan);
    const effective = applyMistakes(plan, scenario.mistakes);
    expect(JSON.stringify(plan)).toBe(before);
    expect(effective.rules.find((r) => r.id === 'run')?.who).toEqual(['p1']);
    const swap = effective.rules.find((r) => r.id === 'swap')!;
    expect(swap.when).toMatchObject({ on: 'aura_stacks', atLeast: 12 });
    expect(effective.roster.find((m) => m.id === 'p1')?.reaction).toEqual({ minMs: 1000, maxMs: 1500 });
  });

  it('disable_rule removes the rule', () => {
    const { plan } = parsed();
    expect(applyMistakes(plan, [{ type: 'disable_rule', rule: 'swap' }]).rules.map((r) => r.id)).toEqual(['run']);
  });

  it('prepareRun returns base and effective plans', () => {
    const { plan, scenario } = parsed();
    const r = prepareRun({ plan, planFile: 'plan.yaml', scenario, scenarioFile: 'scenario.yaml' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.basePlan.rules.find((x) => x.id === 'run')?.who).toEqual(['p1', 'p2']);
    expect(r.value.plan.rules.find((x) => x.id === 'run')?.who).toEqual(['p1']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/plan.test.ts`
Expected: FAIL, cannot resolve `../src/plan/mistakes`.

- [ ] **Step 3: Write `plan/schema.ts`**

`packages/engine/src/plan/schema.ts`:
```ts
import { DifficultySchema } from '@raid/data';
import { z } from 'zod';
import { EVENT_KINDS } from '../trace';

export const IdSchema = z.string().regex(/^[a-z0-9_-]+$/, 'ids use lowercase letters, digits, _ and -');
/** Unit references with a special meaning; roster ids must not use them. */
export const RESERVED_REFS: readonly string[] = ['self', 'current_tank', 'boss'];
const TextKeySchema = z.string().regex(/^[a-z0-9_.]+$/, 'text keys use lowercase letters, digits, _ and .');
const Vec2Schema = z.object({ x: z.number(), y: z.number() }).strict();
const ReactionSchema = z.object({ minMs: z.number().int().min(0), maxMs: z.number().int().min(0) }).strict();
export const PlayerRoleSchema = z.enum(['tank', 'healer', 'melee', 'ranged']);

export const ModelledMemberSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    kind: z.literal('modelled'),
    spec: IdSchema,
    profile: IdSchema,
    reaction: ReactionSchema,
  })
  .strict();

export const StandinMemberSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    kind: z.literal('standin'),
    role: PlayerRoleSchema,
    maxHealth: z.number().int().positive(),
    ratePerSecond: z.number().min(0),
    buffs: z.array(IdSchema).default([]),
    reaction: ReactionSchema,
  })
  .strict();

export const MemberSchema = z.discriminatedUnion('kind', [ModelledMemberSchema, StandinMemberSchema]);

export const TriggerSchema = z.discriminatedUnion('on', [
  z.object({ on: z.literal('aura_applied'), aura: IdSchema, target: IdSchema }).strict(),
  z.object({ on: z.literal('aura_stacks'), aura: IdSchema, target: IdSchema, atLeast: z.number().int().min(1) }).strict(),
  z.object({ on: z.literal('cast_start'), spell: IdSchema, caster: IdSchema }).strict(),
  z.object({ on: z.literal('time'), atMs: z.number().int().min(0) }).strict(),
  z.object({ on: z.literal('health_below'), target: IdSchema, pct: z.number().gt(0).max(100) }).strict(),
]);

export const ActionSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('move_to'), spot: IdSchema }).strict(),
  z.object({ do: z.literal('return_to_assignment') }).strict(),
  z.object({ do: z.literal('stop_casting') }).strict(),
  z.object({ do: z.literal('taunt'), target: IdSchema }).strict(),
  z.object({ do: z.literal('use_cooldown'), spell: IdSchema, target: IdSchema.optional() }).strict(),
]);

export const RuleSchema = z
  .object({
    id: IdSchema,
    who: z.array(IdSchema).min(1),
    when: TriggerSchema,
    do: ActionSchema,
    priority: z.number().int().min(1).max(100).default(50),
    mode: z.literal('edge').default('edge'),
    cooldownMs: z.number().int().min(0).default(0),
    retry: z.object({ times: z.number().int().min(1), everyMs: z.number().int().min(1) }).strict().optional(),
  })
  .strict();

export const PlanSchema = z
  .object({
    id: IdSchema,
    boss: IdSchema,
    roster: z.array(MemberSchema).min(1),
    spots: z.record(IdSchema, Vec2Schema),
    phases: z.array(z.object({ phase: IdSchema, assignments: z.record(IdSchema, IdSchema) }).strict()).min(1),
    rules: z.array(RuleSchema).default([]),
  })
  .strict();

export const MistakeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('disable_rule'), rule: IdSchema }).strict(),
  z.object({ type: z.literal('exclude_from_rule'), rule: IdSchema, player: IdSchema }).strict(),
  z.object({ type: z.literal('set_stack_threshold'), rule: IdSchema, atLeast: z.number().int().min(1) }).strict(),
  z
    .object({ type: z.literal('reaction'), player: IdSchema, minMs: z.number().int().min(0), maxMs: z.number().int().min(0) })
    .strict(),
]);

const WhereSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({});

export const ObservationCheckSchema = z.discriminatedUnion('check', [
  z.object({ check: z.literal('outcome_is'), outcome: z.enum(['kill', 'wipe', 'timeout']) }).strict(),
  z.object({ check: z.literal('event_occurs'), kind: z.enum(EVENT_KINDS), where: WhereSchema }).strict(),
  z.object({ check: z.literal('event_absent'), kind: z.enum(EVENT_KINDS), where: WhereSchema }).strict(),
  z
    .object({
      check: z.literal('custom'),
      name: z.string().regex(/^[a-z0-9_.-]+$/),
      params: z.record(z.string(), z.unknown()).default({}),
    })
    .strict(),
]);

export const AnnotationSchema = z
  .object({
    text: TextKeySchema,
    at: z.union([
      z.object({ ms: z.number().int().min(0) }).strict(),
      z.object({ event: z.enum(EVENT_KINDS), nth: z.number().int().min(1).default(1), where: WhereSchema }).strict(),
    ]),
  })
  .strict();

export const ScenarioSchema = z
  .object({
    id: IdSchema,
    plan: z.string().min(1),
    difficulty: DifficultySchema,
    seed: z.number().int().min(0),
    profile: z.enum(['azerothcore', 'rising-gods']).default('azerothcore'),
    maxDurationMs: z.number().int().positive(),
    mistakes: z.array(MistakeSchema).default([]),
    observation: z.object({ text: TextKeySchema, checks: z.array(ObservationCheckSchema).min(1) }).strict(),
    annotations: z.array(AnnotationSchema).default([]),
  })
  .strict();

export type Plan = z.infer<typeof PlanSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type ModelledMember = z.infer<typeof ModelledMemberSchema>;
export type StandinMember = z.infer<typeof StandinMemberSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Mistake = z.infer<typeof MistakeSchema>;
export type ObservationCheck = z.infer<typeof ObservationCheckSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
```

- [ ] **Step 4: Write `plan/validate.ts`**

`packages/engine/src/plan/validate.ts`:
```ts
import { RESERVED_REFS, type Plan, type Rule, type Scenario } from './schema';

export interface LoadProblem {
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

export function crossValidate(plan: Plan, planFile: string, scenario: Scenario | null, scenarioFile: string): LoadProblem[] {
  const out: LoadProblem[] = [];
  const inPlan = (path: string, message: string) => out.push({ file: planFile, path, message });
  const inScenario = (path: string, message: string) => out.push({ file: scenarioFile, path, message });

  const roster = new Set<string>();
  plan.roster.forEach((m, i) => {
    if (roster.has(m.id)) inPlan(`roster.${i}.id`, `duplicate roster id ${m.id}`);
    if (RESERVED_REFS.includes(m.id)) inPlan(`roster.${i}.id`, `${m.id} is reserved`);
    if (m.reaction.minMs > m.reaction.maxMs) inPlan(`roster.${i}.reaction`, 'minMs must not exceed maxMs');
    roster.add(m.id);
  });
  const ref = (path: string, r: string) => {
    if (!RESERVED_REFS.includes(r) && !roster.has(r)) inPlan(path, `unknown unit ${r}`);
  };

  const spots = new Set(Object.keys(plan.spots));
  const phases = new Set<string>();
  plan.phases.forEach((ph, i) => {
    if (phases.has(ph.phase)) inPlan(`phases.${i}.phase`, `duplicate phase ${ph.phase}`);
    phases.add(ph.phase);
    for (const [who, spot] of Object.entries(ph.assignments)) {
      if (!roster.has(who)) inPlan(`phases.${i}.assignments.${who}`, `unknown roster id ${who}`);
      if (!spots.has(spot)) inPlan(`phases.${i}.assignments.${who}`, `unknown spot ${spot}`);
    }
  });
  const def = plan.phases.find((p) => p.phase === 'default');
  if (!def) inPlan('phases', 'a phase named default is required');
  else for (const m of plan.roster) if (!(m.id in def.assignments)) inPlan('phases', `${m.id} has no assignment in phase default`);

  const rules = new Map<string, Rule>();
  plan.rules.forEach((r, i) => {
    if (rules.has(r.id)) inPlan(`rules.${i}.id`, `duplicate rule id ${r.id}`);
    rules.set(r.id, r);
    r.who.forEach((w, j) => {
      if (!roster.has(w)) inPlan(`rules.${i}.who.${j}`, `unknown roster id ${w}`);
    });
    const w = r.when;
    if (w.on === 'aura_applied' || w.on === 'aura_stacks' || w.on === 'health_below') ref(`rules.${i}.when.target`, w.target);
    if (w.on === 'cast_start') ref(`rules.${i}.when.caster`, w.caster);
    const a = r.do;
    if (a.do === 'move_to' && !spots.has(a.spot)) inPlan(`rules.${i}.do.spot`, `unknown spot ${a.spot}`);
    if (a.do === 'taunt') ref(`rules.${i}.do.target`, a.target);
    if (a.do === 'use_cooldown' && a.target !== undefined) ref(`rules.${i}.do.target`, a.target);
  });

  scenario?.mistakes.forEach((mk, i) => {
    const path = `mistakes.${i}`;
    if (mk.type === 'reaction') {
      if (!roster.has(mk.player)) inScenario(`${path}.player`, `unknown roster id ${mk.player}`);
      if (mk.minMs > mk.maxMs) inScenario(path, 'minMs must not exceed maxMs');
      return;
    }
    const rule = rules.get(mk.rule);
    if (!rule) {
      inScenario(`${path}.rule`, `unknown rule ${mk.rule}`);
      return;
    }
    if (mk.type === 'exclude_from_rule' && !rule.who.includes(mk.player)) {
      inScenario(`${path}.player`, `${mk.player} is not in rule ${mk.rule}`);
    }
    if (mk.type === 'set_stack_threshold' && rule.when.on !== 'aura_stacks') {
      inScenario(`${path}.rule`, `rule ${mk.rule} has no aura_stacks trigger`);
    }
  });
  return out;
}
```

- [ ] **Step 5: Write `plan/mistakes.ts`**

`packages/engine/src/plan/mistakes.ts`:
```ts
import type { Mistake, Plan } from './schema';

/** Returns the effective plan; the base plan is not changed. */
export function applyMistakes(plan: Plan, mistakes: readonly Mistake[]): Plan {
  const out: Plan = structuredClone(plan);
  for (const mk of mistakes) {
    switch (mk.type) {
      case 'disable_rule':
        out.rules = out.rules.filter((r) => r.id !== mk.rule);
        break;
      case 'exclude_from_rule':
        for (const r of out.rules) if (r.id === mk.rule) r.who = r.who.filter((w) => w !== mk.player);
        break;
      case 'set_stack_threshold':
        for (const r of out.rules) if (r.id === mk.rule && r.when.on === 'aura_stacks') r.when = { ...r.when, atLeast: mk.atLeast };
        break;
      case 'reaction':
        out.roster = out.roster.map((m) => (m.id === mk.player ? { ...m, reaction: { minMs: mk.minMs, maxMs: mk.maxMs } } : m));
        break;
    }
  }
  return out;
}
```

- [ ] **Step 6: Write `plan/prepare.ts`**

`packages/engine/src/plan/prepare.ts`:
```ts
import { zodIssues } from '@raid/data';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { applyMistakes } from './mistakes';
import { PlanSchema, ScenarioSchema, type Plan, type Scenario } from './schema';
import { crossValidate, type LoadProblem } from './validate';

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problems: readonly LoadProblem[] };

export interface PreparedRun {
  readonly scenario: Scenario;
  readonly scenarioFile: string;
  /** The effective plan, with the scenario's mistakes applied. */
  readonly plan: Plan;
  readonly basePlan: Plan;
  readonly planFile: string;
}

function parseDocument<S extends z.ZodTypeAny>(file: string, text: string, schema: S): Parsed<z.infer<S>> {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    return { ok: false, problems: [{ file, path: '(yaml)', message: e instanceof Error ? e.message : String(e) }] };
  }
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, problems: zodIssues(r.error).map((i) => ({ file, path: i.path, message: i.message })) };
  return { ok: true, value: r.data };
}

export function parsePlan(file: string, text: string): Parsed<Plan> {
  return parseDocument(file, text, PlanSchema);
}

export function parseScenario(file: string, text: string): Parsed<Scenario> {
  return parseDocument(file, text, ScenarioSchema);
}

export function prepareRun(input: {
  readonly scenario: Scenario;
  readonly scenarioFile: string;
  readonly plan: Plan;
  readonly planFile: string;
}): Parsed<PreparedRun> {
  const problems = crossValidate(input.plan, input.planFile, input.scenario, input.scenarioFile);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      scenario: input.scenario,
      scenarioFile: input.scenarioFile,
      planFile: input.planFile,
      basePlan: input.plan,
      plan: applyMistakes(input.plan, input.scenario.mistakes),
    },
  };
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/plan.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/plan packages/engine/test/plan.test.ts
git commit -m "feat(engine): plan and scenario schemas with cross validation and mistakes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Rule engine

Semantics (§8.5, A-005, A-010): triggers on events fire every occurrence; condition triggers (`aura_stacks`, `health_below`) fire when the condition becomes true and re-arm when it becomes false. A fired rule writes `rule_fired`, then acts after the actor's reaction delay (drawn from `unit:<id>.reaction`). Movement actions compete by priority: a running rule move with priority ≥ the new rule's priority makes the new move fail with `busy`. Failures write `action_failed`; `retry` re-runs the action. Rules are evaluated in priority order (high first), then by id.

**Files:**
- Create: `packages/engine/src/rules.ts`
- Test: `packages/engine/test/rules.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import { installCoreRules, startCast } from '../src/casting';
import { PlanSchema, type Plan } from '../src/plan/schema';
import { EventClass } from '../src/queue';
import { BUILTIN_ACTIONS, RuleEngine, type ActionHandler } from '../src/rules';
import { Simulation } from '../src/sim';

const fixed = { minMs: 300, maxMs: 300 };
const member = (id: string) => ({ id, name: id, kind: 'standin', role: 'ranged', maxHealth: 10000, ratePerSecond: 0, reaction: fixed });

function plan(rules: unknown[]): Plan {
  return PlanSchema.parse({
    id: 'p',
    boss: 'boss',
    roster: [member('t1'), member('t2'), member('p1')],
    spots: { home: { x: 0, y: 0 }, a: { x: 10, y: 0 }, b: { x: -10, y: 0 } },
    phases: [{ phase: 'default', assignments: { t1: 'home', t2: 'home', p1: 'home' } }],
    rules,
  });
}

function newSim(p: Plan, extra: [string, ActionHandler][] = [], maxDurationMs = 12000) {
  const sim = new Simulation({ seed: 4, maxDurationMs, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1000000, pos: { x: 0, y: 30 }, speedYdPerSec: 7, combatReach: 5, boundingRadius: 2 });
  for (const id of ['t1', 't2', 'p1']) {
    sim.addUnit({ id, name: id, kind: 'player', role: 'ranged', maxHealth: 10000, pos: { x: 0, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  }
  sim.unit('boss').threat.set('t1', 100);
  for (const aura of ['spore', 'other', 'third', 'bloat']) sim.catalog.addAura({ id: aura, durationMs: 60000, maxStacks: 20 });
  sim.catalog.addSpell({ id: 'long', castTimeMs: 3000, gcdMs: 0, cooldownMs: 0, rangeYd: 100, usableWhileMoving: false, target: 'self', effects: [] });
  const engine = new RuleEngine(sim, p, new Map([...BUILTIN_ACTIONS, ...extra]), { currentTank: () => sim.unit('t1') });
  engine.install();
  return { sim, engine };
}

const of = (sim: Simulation, kind: string) => sim.trace.list().filter((e) => e.kind === kind);
const at = (sim: Simulation, t: number, fn: () => void) => sim.at(t, EventClass.SpellHit, fn);

describe('RuleEngine (§8.5)', () => {
  it('acts after the reaction delay and links the cause', () => {
    const { sim } = newSim(plan([{ id: 'run', who: ['p1'], when: { on: 'aura_applied', aura: 'spore', target: 'self' }, do: { do: 'move_to', spot: 'a' } }]));
    at(sim, 1000, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    sim.run();
    const fired = of(sim, 'rule_fired')[0];
    const move = of(sim, 'move_start')[0];
    expect([fired.t, move.t]).toEqual([1000, 1300]);
    expect(move.causes).toEqual([fired.id]);
  });

  it('a stack trigger fires once when crossing the threshold and re-arms after removal', () => {
    const calls: number[] = [];
    const taunt: ActionHandler = (ctx) => (calls.push(ctx.sim.now), { ok: true });
    const { sim } = newSim(
      plan([{ id: 'swap', who: ['t2'], when: { on: 'aura_stacks', aura: 'bloat', target: 'current_tank', atLeast: 3 }, do: { do: 'taunt', target: 'boss' } }]),
      [['taunt', taunt]],
    );
    for (const t of [1000, 2000, 3000, 4000]) at(sim, t, () => void applyAura(sim, 'bloat', 'boss', 't1', []));
    at(sim, 5000, () => void removeAuras(sim, 't1', 'bloat', 'removed', []));
    for (const t of [6000, 7000, 8000]) at(sim, t, () => void applyAura(sim, 'bloat', 'boss', 't1', []));
    sim.run();
    expect(calls).toEqual([3300, 8300]);
  });

  it('a running higher-priority move makes a lower one fail; a higher one pre-empts (A-010)', () => {
    const { sim } = newSim(
      plan([
        { id: 'hi', who: ['p1'], when: { on: 'aura_applied', aura: 'spore', target: 'self' }, do: { do: 'move_to', spot: 'a' }, priority: 80 },
        { id: 'lo', who: ['p1'], when: { on: 'aura_applied', aura: 'other', target: 'self' }, do: { do: 'move_to', spot: 'b' }, priority: 50 },
        { id: 'urgent', who: ['p1'], when: { on: 'aura_applied', aura: 'third', target: 'self' }, do: { do: 'move_to', spot: 'b' }, priority: 90 },
      ]),
    );
    at(sim, 1000, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    at(sim, 1500, () => void applyAura(sim, 'other', 'boss', 'p1', []));
    at(sim, 2000, () => void applyAura(sim, 'third', 'boss', 'p1', []));
    sim.run();
    expect(of(sim, 'action_failed').map((e) => [e.t, e.data.rule, e.data.reason])).toEqual([[1800, 'lo', 'busy']]);
    expect(of(sim, 'move_start').map((e) => [e.t, e.data.toX])).toEqual([
      [1300, 10],
      [2300, -10],
    ]);
  });

  it('retries a failed action and supports time triggers', () => {
    const calls: number[] = [];
    const flaky: ActionHandler = (ctx) => {
      calls.push(ctx.sim.now);
      return calls.length === 1 ? { ok: false, reason: 'out_of_range' } : { ok: true };
    };
    const { sim } = newSim(
      plan([{ id: 'swap', who: ['t2'], when: { on: 'time', atMs: 1000 }, do: { do: 'taunt', target: 'boss' }, retry: { times: 2, everyMs: 500 } }]),
      [['taunt', flaky]],
    );
    sim.run();
    expect(calls).toEqual([1300, 1800]);
    expect(of(sim, 'action_failed').map((e) => [e.t, e.data.reason, e.data.attempt])).toEqual([[1300, 'out_of_range', 0]]);
  });

  it('respects the rule cooldown', () => {
    const { sim } = newSim(
      plan([{ id: 'run', who: ['p1'], when: { on: 'aura_applied', aura: 'spore', target: 'self' }, do: { do: 'move_to', spot: 'a' }, cooldownMs: 5000 }]),
    );
    at(sim, 1000, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    at(sim, 3000, () => void applyAura(sim, 'spore', 't1', 'p1', []));
    at(sim, 7000, () => void applyAura(sim, 'spore', 't2', 'p1', []));
    sim.run();
    expect(of(sim, 'rule_fired').map((e) => e.t)).toEqual([1000, 7000]);
  });

  it('stop_casting interrupts the actor', () => {
    const { sim } = newSim(plan([{ id: 'stop', who: ['p1'], when: { on: 'time', atMs: 1000 }, do: { do: 'stop_casting' } }]));
    at(sim, 0, () => void startCast(sim, 'p1', 'long', 'p1', []));
    sim.run();
    expect(of(sim, 'cast_interrupted').map((e) => [e.t, e.data.reason])).toEqual([[1300, 'stopped']]);
  });

  it('a dead actor does not act; isMoving clears on arrival', () => {
    const { sim, engine } = newSim(plan([{ id: 'run', who: ['p1', 't2'], when: { on: 'time', atMs: 1000 }, do: { do: 'move_to', spot: 'a' } }]));
    at(sim, 500, () => void sim.damage('t2', 1e6, { sourceId: 'boss', ability: 'x', school: 'physical' }, []));
    let movingDuring = false;
    at(sim, 2000, () => {
      movingDuring = engine.isMoving('p1');
    });
    sim.run();
    expect(of(sim, 'move_start').map((e) => e.data.unit)).toEqual(['p1']);
    expect(movingDuring).toBe(true);
    expect(engine.isMoving('p1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/rules.test.ts`
Expected: FAIL, cannot resolve `../src/rules`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/rules.ts`:
```ts
import { interruptCast } from './casting';
import type { Action, Member, Plan, Rule } from './plan/schema';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import type { TraceEvent, TraceValue } from './trace';
import type { Unit, Vec2 } from './units';

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface ActionContext {
  readonly sim: Simulation;
  readonly actor: Unit;
  readonly rule: Rule;
  readonly action: Action;
  readonly causes: readonly string[];
  resolve(ref: string): Unit | null;
  spot(id: string): Vec2;
  assignment(): string | null;
  markMoving(): void;
}

export type ActionHandler = (ctx: ActionContext) => ActionResult;

export interface RuleHooks {
  currentTank(): Unit | null;
}

const MOVE_ACTIONS = new Set(['move_to', 'return_to_assignment']);

const moveTo: ActionHandler = (ctx) => {
  if (ctx.action.do !== 'move_to') return { ok: false, reason: 'wrong_action' };
  ctx.markMoving();
  ctx.sim.startMove(ctx.actor.id, ctx.spot(ctx.action.spot), ctx.causes);
  return { ok: true };
};

const returnToAssignment: ActionHandler = (ctx) => {
  const spot = ctx.assignment();
  if (spot === null) return { ok: false, reason: 'no_assignment' };
  ctx.markMoving();
  ctx.sim.startMove(ctx.actor.id, ctx.spot(spot), ctx.causes);
  return { ok: true };
};

const stopCasting: ActionHandler = (ctx) => {
  if (!ctx.actor.cast) return { ok: false, reason: 'not_casting' };
  interruptCast(ctx.sim, ctx.actor.id, 'stopped', ctx.causes);
  return { ok: true };
};

/** Actions every run supports. `taunt` (Plan 2) and `use_cooldown` (Plan 3) are registered by content. */
export const BUILTIN_ACTIONS: ReadonlyMap<string, ActionHandler> = new Map([
  ['move_to', moveTo],
  ['return_to_assignment', returnToAssignment],
  ['stop_casting', stopCasting],
]);

export class RuleEngine {
  /** actorId → priority of the running rule move. */
  private readonly moving = new Map<string, number>();
  private readonly active = new Map<string, boolean>();
  private readonly lastFired = new Map<string, number>();
  private readonly members: Map<string, Member>;
  private readonly ordered: Rule[];

  constructor(
    private readonly sim: Simulation,
    private readonly plan: Plan,
    private readonly handlers: ReadonlyMap<string, ActionHandler>,
    private readonly hooks: RuleHooks,
  ) {
    this.members = new Map(plan.roster.map((m) => [m.id, m]));
    this.ordered = [...plan.rules].sort(
      (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  isMoving(actorId: string): boolean {
    return this.moving.has(actorId);
  }

  /** The actor's spot in the current phase, falling back to the default phase. */
  assignment(actorId: string): string | null {
    const current = this.plan.phases.find((p) => p.phase === this.sim.phase);
    const fallback = this.plan.phases.find((p) => p.phase === 'default');
    return current?.assignments[actorId] ?? fallback?.assignments[actorId] ?? null;
  }

  install(): void {
    this.sim.subscribe((ev) => this.onEvent(ev));
    for (const rule of this.ordered) {
      const w = rule.when;
      if (w.on !== 'time') continue;
      this.sim.at(Math.max(w.atMs, this.sim.now), EventClass.Decision, () => {
        for (const actorId of rule.who) this.fire(rule, actorId, []);
      });
    }
  }

  private onEvent(ev: TraceEvent): void {
    if ((ev.kind === 'move_end' || ev.kind === 'death') && typeof ev.data.unit === 'string') this.moving.delete(ev.data.unit);
    if (ev.kind === 'phase_change') this.onPhaseChange(ev);
    for (const rule of this.ordered) for (const actorId of rule.who) this.evaluate(rule, actorId, ev);
  }

  private onPhaseChange(ev: TraceEvent): void {
    for (const m of this.plan.roster) {
      const u = this.sim.units.get(m.id);
      const spot = this.assignment(m.id);
      if (!u || !u.alive || spot === null || this.moving.has(m.id)) continue;
      this.sim.startMove(m.id, this.spotOf(spot), [ev.id]);
    }
  }

  private evaluate(rule: Rule, actorId: string, ev: TraceEvent): void {
    const w = rule.when;
    const d = ev.data;
    switch (w.on) {
      case 'aura_applied':
        if (ev.kind === 'aura_applied' && d.aura === w.aura && this.refMatches(w.target, actorId, d.unit)) this.fire(rule, actorId, [ev.id]);
        return;
      case 'cast_start':
        if (ev.kind === 'cast_start' && d.spell === w.spell && this.refMatches(w.caster, actorId, d.caster)) this.fire(rule, actorId, [ev.id]);
        return;
      case 'aura_stacks': {
        if (ev.kind !== 'aura_applied' && ev.kind !== 'aura_stack' && ev.kind !== 'aura_removed') return;
        if (d.aura !== w.aura || !this.refMatches(w.target, actorId, d.unit)) return;
        const stacks = ev.kind === 'aura_removed' ? 0 : Number(d.stacks);
        this.condition(rule, actorId, stacks >= w.atLeast, ev.id);
        return;
      }
      case 'health_below': {
        if (ev.kind !== 'damage' && ev.kind !== 'heal') return;
        if (!this.refMatches(w.target, actorId, d.target)) return;
        const u = this.sim.unit(String(d.target));
        this.condition(rule, actorId, u.alive && (u.health / u.maxHealth) * 100 < w.pct, ev.id);
        return;
      }
      case 'time':
        return;
    }
  }

  private condition(rule: Rule, actorId: string, isTrue: boolean, cause: string): void {
    const key = `${rule.id}|${actorId}`;
    const was = this.active.get(key) ?? false;
    this.active.set(key, isTrue);
    if (isTrue && !was) this.fire(rule, actorId, [cause]);
  }

  private refMatches(ref: string, actorId: string, unitId: TraceValue | undefined): boolean {
    if (typeof unitId !== 'string') return false;
    if (ref === 'self') return unitId === actorId;
    if (ref === 'current_tank') return this.hooks.currentTank()?.id === unitId;
    if (ref === 'boss') return this.sim.bosses().some((b) => b.id === unitId);
    return ref === unitId;
  }

  private fire(rule: Rule, actorId: string, causes: readonly string[]): void {
    const actor = this.sim.units.get(actorId);
    if (!actor || !actor.alive || this.sim.outcome) return;
    const key = `${rule.id}|${actorId}`;
    const last = this.lastFired.get(key);
    if (last !== undefined && this.sim.now < last + rule.cooldownMs) return;
    this.lastFired.set(key, this.sim.now);
    const fired = this.sim.emit('rule_fired', { rule: rule.id, actor: actorId }, causes);
    const reaction = this.members.get(actorId)!.reaction;
    const delay = this.sim.rng.stream(`unit:${actorId}.reaction`).int(reaction.minMs, reaction.maxMs);
    this.sim.at(this.sim.now + delay, EventClass.Decision, () => this.execute(rule, actorId, fired, 0));
  }

  private execute(rule: Rule, actorId: string, cause: string, attempt: number): void {
    const actor = this.sim.unit(actorId);
    if (!actor.alive || this.sim.outcome) return;
    let result: ActionResult;
    const running = this.moving.get(actorId);
    if (MOVE_ACTIONS.has(rule.do.do) && running !== undefined && running >= rule.priority) {
      result = { ok: false, reason: 'busy' };
    } else {
      const handler = this.handlers.get(rule.do.do);
      result = handler ? handler(this.context(rule, actor, [cause])) : { ok: false, reason: 'no_handler' };
    }
    if (result.ok) return;
    this.sim.emit('action_failed', { rule: rule.id, actor: actorId, action: rule.do.do, reason: result.reason, attempt }, [cause]);
    if (rule.retry && attempt < rule.retry.times) {
      this.sim.at(this.sim.now + rule.retry.everyMs, EventClass.Decision, () => this.execute(rule, actorId, cause, attempt + 1));
    }
  }

  private spotOf(id: string): Vec2 {
    const s = this.plan.spots[id];
    if (!s) throw new Error(`unknown spot ${id}`);
    return s;
  }

  private context(rule: Rule, actor: Unit, causes: readonly string[]): ActionContext {
    return {
      sim: this.sim,
      actor,
      rule,
      action: rule.do,
      causes,
      resolve: (ref) => {
        if (ref === 'self') return actor;
        if (ref === 'current_tank') return this.hooks.currentTank();
        if (ref === 'boss') return this.sim.bosses()[0] ?? null;
        return this.sim.units.get(ref) ?? null;
      },
      spot: (id) => this.spotOf(id),
      assignment: () => this.assignment(actor.id),
      markMoving: () => {
        this.moving.set(actor.id, rule.priority);
      },
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/rules.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/rules.ts packages/engine/test/rules.test.ts
git commit -m "feat(engine): rule engine with edge triggers, reaction delays, priorities and retries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Stand-ins

Behaviour (§6.3, A-011): a stand-in has health, a position, normal movement and reaction time through plan rules, can be targeted, damaged, healed and killed like any player, and once per second either damages the first living boss in range or heals the lowest-health injured player in range, at its configured rate, and only while not moving. It never models resources, cooldowns or procs, and it is marked `approximate`. Raid buffs a stand-in provides are applied in Plan 3, together with stats.

**Files:**
- Create: `packages/engine/src/standin.ts`
- Test: `packages/engine/test/standin.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/standin.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { StandinMemberSchema } from '../src/plan/schema';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { installStandin } from '../src/standin';

const standin = (id: string, role: 'tank' | 'healer' | 'ranged', ratePerSecond: number) =>
  StandinMemberSchema.parse({ id, name: id, kind: 'standin', role, maxHealth: 40000, ratePerSecond, reaction: { minMs: 300, maxMs: 300 } });

function newSim() {
  const sim = new Simulation({ seed: 6, maxDurationMs: 3500, sampleIntervalMs: 1000 });
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1000000, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 5, boundingRadius: 2 });
  const place = { t1: { x: 6, y: 0 }, h1: { x: 0, y: 20 }, d1: { x: 0, y: -20 }, d2: { x: 0, y: -50 } } as const;
  const members = [standin('t1', 'tank', 500), standin('h1', 'healer', 800), standin('d1', 'ranged', 1000), standin('d2', 'ranged', 1000)];
  for (const m of members) {
    sim.addUnit({ id: m.id, name: m.id, kind: 'player', role: m.role, approximate: true, maxHealth: m.maxHealth, pos: place[m.id as keyof typeof place], speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
    installStandin(sim, m);
  }
  return sim;
}

const of = (sim: Simulation, kind: string) => sim.trace.list().filter((e) => e.kind === kind);

describe('stand-ins (§6.3)', () => {
  it('damage in range once per second, nothing out of range or while moving', () => {
    const sim = newSim();
    sim.at(1500, EventClass.Decision, () => void sim.startMove('d1', { x: 0, y: -30 }, []));
    sim.run();
    const bySource = (id: string) => of(sim, 'damage').filter((e) => e.data.source === id).map((e) => e.t);
    expect(bySource('t1')).toEqual([1000, 2000, 3000]);
    expect(bySource('d1')).toEqual([1000, 3000]);
    expect(bySource('d2')).toEqual([]);
    expect(of(sim, 'damage')[0].data).toMatchObject({ ability: 'standin_damage', amount: 500 });
  });

  it('a healer heals the lowest injured player in range', () => {
    const sim = newSim();
    sim.at(500, EventClass.SpellHit, () => void sim.damage('t1', 2000, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    sim.at(500, EventClass.SpellHit, () => void sim.damage('d2', 9000, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    sim.run();
    const heals = of(sim, 'heal').map((e) => [e.t, e.data.target, e.data.amount]);
    // d2 is lower but 70 yd away (out of the 40 yd range), so t1 is healed.
    expect(heals[0]).toEqual([1000, 't1', 800]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/standin.test.ts`
Expected: FAIL, cannot resolve `../src/standin`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/standin.ts`:
```ts
import { edgeDistance } from './movement';
import type { StandinMember } from './plan/schema';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import type { Unit } from './units';

/** Stand-in parameters (A-011). They are approximations by definition and reported as such. */
export const STANDIN_TICK_MS = 1000;
export const STANDIN_RANGE_YD = { tank: 5, melee: 5, ranged: 40, healer: 40 } as const;

function healTarget(sim: Simulation, self: Unit): Unit | null {
  let best: Unit | null = null;
  let bestRatio = 1;
  for (const p of sim.players()) {
    if (!p.alive || p.health >= p.maxHealth) continue;
    if (edgeDistance(self, p, sim.now) > STANDIN_RANGE_YD.healer) continue;
    const ratio = p.health / p.maxHealth;
    if (ratio < bestRatio) {
      best = p;
      bestRatio = ratio;
    }
  }
  return best;
}

export function installStandin(sim: Simulation, member: StandinMember): void {
  const range = STANDIN_RANGE_YD[member.role];
  const amount = Math.round((member.ratePerSecond * STANDIN_TICK_MS) / 1000);
  const tick = (): void => {
    const self = sim.unit(member.id);
    if (!self.alive || sim.outcome) return;
    if (!self.move && amount > 0) {
      if (member.role === 'healer') {
        const target = healTarget(sim, self);
        if (target) sim.heal(target.id, amount, { sourceId: self.id, ability: 'standin_heal', school: 'holy' }, []);
      } else {
        const boss = sim.bosses().find((b) => b.alive && edgeDistance(self, b, sim.now) <= range);
        if (boss) sim.damage(boss.id, amount, { sourceId: self.id, ability: 'standin_damage', school: 'physical' }, []);
      }
    }
    sim.at(sim.now + STANDIN_TICK_MS, EventClass.Decision, tick);
  };
  sim.at(sim.now + STANDIN_TICK_MS, EventClass.Decision, tick);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/standin.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/standin.ts packages/engine/test/standin.test.ts
git commit -m "feat(engine): labelled stand-ins for unmodelled specs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Observations, limitation report and summary

**Files:**
- Create: `packages/engine/src/observations.ts`, `packages/engine/src/limitations.ts`, `packages/engine/src/summary.ts`
- Test: `packages/engine/test/summary.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/summary.test.ts`:
```ts
import { DataRegistry, PINS } from '@raid/data';
import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import type { BossScript } from '../src/boss';
import { collectLimitations } from '../src/limitations';
import { evaluateObservations, type CustomCheck } from '../src/observations';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';
import { buildSummary } from '../src/summary';

function fight() {
  const sim = new Simulation({ seed: 8, maxDurationMs: 10000, sampleIntervalMs: 1000 });
  const body = { speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389, pos: { x: 0, y: 0 } };
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1000000 });
  sim.addUnit({ ...body, id: 'p1', name: 'Alice', kind: 'player', role: 'ranged', maxHealth: 250, approximate: true });
  sim.addUnit({ ...body, id: 'p2', name: 'Bob', kind: 'player', role: 'healer', maxHealth: 1000 });
  sim.catalog.addAura({
    id: 'rot',
    durationMs: 5000,
    maxStacks: 5,
    periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'nature', min: 100, max: 100 }] },
  });
  sim.at(0, EventClass.SpellHit, () => {
    applyAura(sim, 'rot', 'boss', 'p1', []);
    applyAura(sim, 'rot', 'boss', 'p1', []);
  });
  sim.at(500, EventClass.SpellHit, () => void sim.heal('p1', 80, { sourceId: 'p2', ability: 'mend', school: 'holy' }, []));
  sim.run();
  const trace = sim.trace.build({
    engineVersion: 'test',
    azerothcoreCommit: PINS.azerothcoreCommit,
    spellDataVersions: [],
    scenario: 's',
    boss: 'boss',
    difficulty: '25n',
    seed: 8,
    profile: 'azerothcore',
    aiUpdateIntervalMs: 10,
    sampleIntervalMs: 1000,
    units: sim.sortedUnits().map((u) => ({ id: u.id, name: u.name, kind: u.kind, role: u.role, approximate: u.approximate })),
  });
  return { sim, trace };
}

const script: BossScript = {
  bossId: 'boss',
  mechanics: [
    { key: 'boss.rot', status: 'implemented', omissions: [], validation: 'azerothcore_source' },
    { key: 'boss.cleave', status: 'partial', omissions: ['arc not modelled'], validation: 'unvalidated' },
  ],
  knownServerDifferences: ['example difference'],
  onEngage: () => {},
  updateAI: () => {},
};

describe('summary (§9)', () => {
  it('records deaths with the killing blow and the causal chain', () => {
    const { trace } = fight();
    const s = buildSummary(trace, collectLimitations(fight().sim, new DataRegistry([]), []), []);
    expect(s.outcome).toBe('timeout');
    expect(s.durationMs).toBe(10000);
    expect(s.deaths).toHaveLength(1);
    const d = s.deaths[0];
    expect(d).toMatchObject({ unit: 'p1', atMs: 3000, killingBlow: { ability: 'rot', source: 'boss', amount: 50, overkill: 50 } });
    expect(d.chain.map((id) => trace.events.find((e) => e.id === id)!.kind)).toEqual(['damage', 'periodic_tick', 'aura_applied']);
  });

  it('totals damage, healing and overhealing, and the highest stacks', () => {
    const { sim, trace } = fight();
    const s = buildSummary(trace, collectLimitations(sim, new DataRegistry([]), []), []);
    expect(s.units.boss.damageDone).toBe(250);
    expect(s.units.p1.damageTaken).toBe(250);
    expect(s.units.p2).toMatchObject({ healingDone: 0, overhealing: 80 });
    expect(s.maxStacks.rot).toEqual({ unit: 'p1', stacks: 2 });
  });
});

describe('observations (§10.3)', () => {
  it('evaluates built-in and custom checks', () => {
    const { trace } = fight();
    const deaths: CustomCheck = ({ trace: t, params }) => {
      const n = t.events.filter((e) => e.kind === 'death').length;
      return { pass: n === params.expected, detail: `${n} deaths` };
    };
    const results = evaluateObservations(
      [
        { check: 'outcome_is', outcome: 'timeout' },
        { check: 'event_occurs', kind: 'death', where: { unit: 'p1' } },
        { check: 'event_absent', kind: 'death', where: { unit: 'p2' } },
        { check: 'custom', name: 'count.deaths', params: { expected: 1 } },
        { check: 'custom', name: 'missing', params: {} },
      ],
      trace,
      new Map([['count.deaths', deaths]]),
    );
    expect(results.map((r) => r.pass)).toEqual([true, true, true, true, false]);
    expect(results[4].detail).toBe('unknown custom check');
  });
});

describe('limitations (§6.4)', () => {
  it('lists stand-ins, used assumptions, partial mechanics and known differences', () => {
    const { sim } = fight();
    const data = new DataRegistry([
      { key: 'a.used', value: 1, source: { kind: 'assumption', rationale: 'r1', confirmBy: 'c1' } },
      { key: 'a.unused', value: 1, source: { kind: 'assumption', rationale: 'r2', confirmBy: 'c2' } },
      { key: 'c.used', value: 1, source: { kind: 'configured', file: 'f' } },
    ]);
    data.get('a.used');
    data.get('c.used');
    const l = collectLimitations(sim, data, [script]);
    expect(l.standIns).toEqual(['p1']);
    expect(l.assumptions).toEqual([{ key: 'a.used', rationale: 'r1', confirmBy: 'c1' }]);
    expect(l.partialMechanics).toEqual([{ boss: 'boss', key: 'boss.cleave', status: 'partial', omissions: ['arc not modelled'] }]);
    expect(l.knownServerDifferences).toEqual(['example difference']);
    expect(l.unappliedOverrides).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/summary.test.ts`
Expected: FAIL, cannot resolve `../src/limitations`.

- [ ] **Step 3: Write `limitations.ts`**

`packages/engine/src/limitations.ts`:
```ts
import type { DataRegistry } from '@raid/data';
import type { BossScript } from './boss';
import type { Simulation } from './sim';

export interface Limitations {
  readonly standIns: readonly string[];
  readonly assumptions: readonly { readonly key: string; readonly rationale: string; readonly confirmBy: string }[];
  readonly partialMechanics: readonly {
    readonly boss: string;
    readonly key: string;
    readonly status: string;
    readonly omissions: readonly string[];
  }[];
  readonly knownServerDifferences: readonly string[];
  readonly unappliedOverrides: readonly string[];
}

export function collectLimitations(sim: Simulation, data: DataRegistry, scripts: readonly BossScript[]): Limitations {
  return {
    standIns: sim.sortedUnits((u) => u.approximate).map((u) => u.id),
    assumptions: data
      .accessedEntries()
      .flatMap((r) => (r.source.kind === 'assumption' ? [{ key: r.key, rationale: r.source.rationale, confirmBy: r.source.confirmBy }] : [])),
    partialMechanics: scripts.flatMap((s) =>
      s.mechanics
        .filter((m) => m.status !== 'implemented')
        .map((m) => ({ boss: s.bossId, key: m.key, status: m.status, omissions: [...m.omissions] })),
    ),
    knownServerDifferences: scripts.flatMap((s) => [...s.knownServerDifferences]),
    unappliedOverrides: data.knownUnappliedOverrides(),
  };
}
```

- [ ] **Step 4: Write `summary.ts`**

`packages/engine/src/summary.ts`:
```ts
import type { Limitations } from './limitations';
import type { ObservationResult } from './observations';
import type { OutcomeKind } from './sim';
import type { Trace, TraceEvent } from './trace';

export interface UnitTotals {
  damageDone: number;
  healingDone: number;
  overhealing: number;
  damageTaken: number;
}

export interface DeathRecord {
  readonly unit: string;
  readonly atMs: number;
  readonly killingBlow: {
    readonly event: string;
    readonly ability: string;
    readonly source: string;
    readonly amount: number;
    readonly overkill: number;
  } | null;
  /** Event ids leading to the death, breadth-first from the death's causes, at most CHAIN_LIMIT. */
  readonly chain: readonly string[];
}

export interface Summary {
  readonly outcome: OutcomeKind;
  readonly durationMs: number;
  readonly deaths: readonly DeathRecord[];
  readonly units: Readonly<Record<string, UnitTotals>>;
  readonly maxStacks: Readonly<Record<string, { readonly unit: string; readonly stacks: number }>>;
  readonly observations: readonly ObservationResult[];
  readonly limitations: Limitations;
}

export const CHAIN_LIMIT = 10;

export function outcomeOf(trace: Trace): { readonly kind: OutcomeKind; readonly atMs: number } {
  const ev = [...trace.events].reverse().find((e) => e.kind === 'outcome');
  if (!ev) throw new Error('trace has no outcome event');
  return { kind: ev.data.kind as OutcomeKind, atMs: ev.t };
}

export function causeChain(trace: Trace, start: TraceEvent, limit = CHAIN_LIMIT): string[] {
  const byId = new Map(trace.events.map((e) => [e.id, e]));
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [...start.causes];
  while (queue.length > 0 && out.length < limit) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    const ev = byId.get(id);
    if (ev) queue.push(...ev.causes);
  }
  return out;
}

export function buildSummary(trace: Trace, limitations: Limitations, observations: readonly ObservationResult[]): Summary {
  const byId = new Map(trace.events.map((e) => [e.id, e]));
  const units: Record<string, UnitTotals> = {};
  const totals = (id: string): UnitTotals => (units[id] ??= { damageDone: 0, healingDone: 0, overhealing: 0, damageTaken: 0 });
  for (const u of trace.meta.units) totals(u.id);
  const maxStacks: Record<string, { unit: string; stacks: number }> = {};
  const deaths: DeathRecord[] = [];
  for (const e of trace.events) {
    const d = e.data;
    if (e.kind === 'damage') {
      totals(String(d.source)).damageDone += Number(d.amount);
      totals(String(d.target)).damageTaken += Number(d.amount);
    } else if (e.kind === 'heal') {
      const t = totals(String(d.source));
      t.healingDone += Number(d.amount);
      t.overhealing += Number(d.overheal);
    } else if (e.kind === 'aura_applied' || e.kind === 'aura_stack') {
      const aura = String(d.aura);
      const stacks = Number(d.stacks);
      const cur = maxStacks[aura];
      if (!cur || stacks > cur.stacks) maxStacks[aura] = { unit: String(d.unit), stacks };
    } else if (e.kind === 'death') {
      const blow = e.causes.map((c) => byId.get(c)).find((c) => c?.kind === 'damage');
      deaths.push({
        unit: String(d.unit),
        atMs: e.t,
        killingBlow: blow
          ? {
              event: blow.id,
              ability: String(blow.data.ability),
              source: String(blow.data.source),
              amount: Number(blow.data.amount),
              overkill: Number(blow.data.overkill),
            }
          : null,
        chain: causeChain(trace, e),
      });
    }
  }
  const outcome = outcomeOf(trace);
  return { outcome: outcome.kind, durationMs: outcome.atMs, deaths, units, maxStacks, observations: [...observations], limitations };
}
```

- [ ] **Step 5: Write `observations.ts`**

`packages/engine/src/observations.ts`:
```ts
import type { ObservationCheck } from './plan/schema';
import { outcomeOf } from './summary';
import type { Trace, TraceEvent } from './trace';

export type CustomCheck = (args: {
  readonly trace: Trace;
  readonly params: Readonly<Record<string, unknown>>;
}) => { readonly pass: boolean; readonly detail: string };

export interface ObservationResult {
  readonly check: string;
  readonly pass: boolean;
  readonly detail: string;
}

function matches(e: TraceEvent, kind: string, where: Readonly<Record<string, string | number | boolean>>): boolean {
  if (e.kind !== kind) return false;
  return Object.entries(where).every(([k, v]) => e.data[k] === v);
}

export function evaluateObservations(
  checks: readonly ObservationCheck[],
  trace: Trace,
  custom: ReadonlyMap<string, CustomCheck>,
): ObservationResult[] {
  return checks.map((c): ObservationResult => {
    switch (c.check) {
      case 'outcome_is': {
        const actual = outcomeOf(trace).kind;
        return { check: 'outcome_is', pass: actual === c.outcome, detail: `expected ${c.outcome}, got ${actual}` };
      }
      case 'event_occurs': {
        const n = trace.events.filter((e) => matches(e, c.kind, c.where)).length;
        return { check: `event_occurs:${c.kind}`, pass: n > 0, detail: `${n} matching events` };
      }
      case 'event_absent': {
        const n = trace.events.filter((e) => matches(e, c.kind, c.where)).length;
        return { check: `event_absent:${c.kind}`, pass: n === 0, detail: `${n} matching events` };
      }
      case 'custom': {
        const fn = custom.get(c.name);
        if (!fn) return { check: `custom:${c.name}`, pass: false, detail: 'unknown custom check' };
        const r = fn({ trace, params: c.params });
        return { check: `custom:${c.name}`, pass: r.pass, detail: r.detail };
      }
    }
  });
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/summary.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/observations.ts packages/engine/src/limitations.ts packages/engine/src/summary.ts packages/engine/test/summary.test.ts
git commit -m "feat(engine): run summary, causal death chains, observation checks and limitation report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Core data, runner and the test boss

The runner is the engine's single entry point: it rejects unknown content as `invalid`, builds the data registry (core data + boss data, with the scenario's profile), places every roster member at its default assignment, wires stand-ins, policies and rules, attaches the boss, runs, and returns the canonical trace with the summary. Initial aggro is the boss module's job (`pull`), so Plan 2's threat model plugs in without touching the runner.

**Files:**
- Create: `packages/engine/src/core-data.ts`, `packages/engine/src/run.ts`
- Create: `packages/engine/test/fixtures/dummy-boss.ts`, `packages/engine/test/fixtures/test-caster.ts`, `packages/engine/test/fixtures/dummy-plan.ts`
- Test: `packages/engine/test/run.test.ts`

- [ ] **Step 1: Write the fixtures**

`packages/engine/test/fixtures/dummy-boss.ts`:
```ts
import { applyAura } from '../../src/auras';
import { EventScriptedAI, type BossContext, type MechanicStatus } from '../../src/boss';
import { edgeDistance } from '../../src/movement';
import type { BossModule } from '../../src/run';

const FILE = 'packages/engine/test/fixtures/dummy-boss.ts';
const configured = { kind: 'configured', file: FILE } as const;

export const DUMMY_DATA = [
  { key: 'dummy.pick_interval_ms', value: 12000, source: configured },
  { key: 'dummy.pick_range_yd', value: 30, source: configured },
  { key: 'dummy.mark_duration_ms', value: 3000, source: configured },
  { key: 'dummy.guess', value: 1, source: { kind: 'assumption', rationale: 'fixture assumption', confirmBy: 'never: test fixture' } },
];

const EVENT_MARK = 1;

/** Every interval, marks two random players within range of the boss. */
class DummyAI extends EventScriptedAI {
  readonly bossId = 'dummy';
  readonly mechanics: readonly MechanicStatus[] = [
    { key: 'dummy.mark', status: 'implemented', omissions: [], validation: 'unvalidated' },
    { key: 'dummy.cleave', status: 'partial', omissions: ['cleave arc not modelled'], validation: 'unvalidated' },
  ];
  readonly knownServerDifferences: readonly string[] = ['fixture: no real server'];

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
    const eligible = ctx.sim.players().filter((p) => p.alive && edgeDistance(ctx.self, p, ctx.sim.now) <= this.rangeYd);
    const picked = ctx.pick('mark', eligible, 2);
    const ev = ctx.ai('mark', { eligible: eligible.map((u) => u.id), picked: picked.map((u) => u.id) });
    for (const u of picked) applyAura(ctx.sim, 'mark', ctx.self.id, u.id, [ev]);
    ctx.publishTimer('mark', this.intervalMs, this.intervalMs, [ev]);
    this.events.schedule(EVENT_MARK, this.intervalMs);
  }
}

export const dummyBoss: BossModule = {
  id: 'dummy',
  data: DUMMY_DATA,
  overrides: [],
  setup({ sim, data }) {
    sim.addUnit({ id: 'dummy', name: 'Training Dummy', kind: 'creature', role: 'boss', maxHealth: 10000000, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 5, boundingRadius: 2 });
    sim.catalog.addAura({ id: 'mark', durationMs: data.num('dummy.mark_duration_ms'), maxStacks: 1 });
    data.num('dummy.guess');
    return {
      script: new DummyAI(data.num('dummy.pick_interval_ms'), data.num('dummy.pick_range_yd')),
      bossUnitId: 'dummy',
      pull(s) {
        const tank = s.players().find((p) => p.role === 'tank');
        if (tank) s.unit('dummy').threat.set(tank.id, 1);
      },
    };
  },
};
```

`packages/engine/test/fixtures/test-caster.ts`:
```ts
import type { PolicyFactory } from '../../src/run';

/** A minimal spec: casts a 1.5 s bolt at the boss whenever it can. */
export const testCaster: PolicyFactory = {
  spec: 'test_caster',
  role: 'ranged',
  create({ sim, data }) {
    if (!sim.catalog.hasSpell('test_bolt')) {
      sim.catalog.addSpell({
        id: 'test_bolt',
        castTimeMs: 1500,
        gcdMs: 1500,
        cooldownMs: 0,
        rangeYd: 40,
        usableWhileMoving: false,
        target: 'unit',
        effects: [{ type: 'damage', school: 'fire', min: 1000, max: 1200 }],
      });
    }
    return {
      unit: {
        maxHealth: 20000,
        speedYdPerSec: data.num('core.player_run_speed_yd_s'),
        combatReach: data.num('core.player_combat_reach_yd'),
        boundingRadius: data.num('core.player_bounding_radius_yd'),
      },
      policy: {
        wakeOn: { anyHealthChange: false, anyAuraChange: false },
        decide(view) {
          const boss = view.units.find((u) => u.role === 'boss' && u.alive);
          if (!boss || !view.canCast('test_bolt', boss.id).ok) return { type: 'none' };
          return { type: 'cast', spell: 'test_bolt', target: boss.id };
        },
      },
    };
  },
};
```

`packages/engine/test/fixtures/dummy-plan.ts`:
```ts
export const PLAN_YAML = `
id: dummy-basic
boss: dummy
roster:
  - { id: t1, name: Tanky, kind: standin, role: tank, maxHealth: 40000, ratePerSecond: 500, reaction: { minMs: 300, maxMs: 300 } }
  - { id: h1, name: Healy, kind: standin, role: healer, maxHealth: 20000, ratePerSecond: 800, reaction: { minMs: 300, maxMs: 300 } }
  - { id: p1, name: Alice, kind: modelled, spec: test_caster, profile: default, reaction: { minMs: 300, maxMs: 500 } }
  - { id: p2, name: Bob, kind: modelled, spec: test_caster, profile: default, reaction: { minMs: 300, maxMs: 500 } }
  - { id: p3, name: Cara, kind: standin, role: ranged, maxHealth: 20000, ratePerSecond: 1000, reaction: { minMs: 300, maxMs: 500 } }
spots:
  tank: { x: 6, y: 0 }
  heal: { x: -20, y: 0 }
  ranged: { x: 20, y: 0 }
  far: { x: 50, y: 0 }
phases:
  - phase: default
    assignments: { t1: tank, h1: heal, p1: ranged, p2: ranged, p3: ranged }
rules:
  - id: run-when-marked
    who: [p1, p2, p3, h1]
    when: { on: aura_applied, aura: mark, target: self }
    do: { do: move_to, spot: far }
    priority: 60
`;

export const SCENARIO_YAML = `
id: dummy-clean
plan: dummy-plan.yaml
difficulty: 25n
seed: 1234
maxDurationMs: 30000
observation:
  text: scenario.dummy_clean.observation
  checks:
    - { check: outcome_is, outcome: timeout }
    - { check: event_occurs, kind: aura_applied, where: { aura: mark } }
`;
```

- [ ] **Step 2: Write the failing test**

`packages/engine/test/run.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parsePlan, parseScenario, prepareRun, type PreparedRun } from '../src/plan/prepare';
import type { Mistake } from '../src/plan/schema';
import { runScenario, type ContentRegistry } from '../src/run';
import { canonicalStringify, type TraceValue } from '../src/trace';
import { dummyBoss } from './fixtures/dummy-boss';
import { PLAN_YAML, SCENARIO_YAML } from './fixtures/dummy-plan';
import { testCaster } from './fixtures/test-caster';

const registry: ContentRegistry = {
  bosses: new Map([['dummy', dummyBoss]]),
  policies: new Map([['test_caster', testCaster]]),
  actions: new Map(),
  checks: new Map(),
};

function prepared(mistakes: Mistake[] = [], planYaml = PLAN_YAML): PreparedRun {
  const plan = parsePlan('dummy-plan.yaml', planYaml);
  const scenario = parseScenario('dummy-scenario.yaml', SCENARIO_YAML);
  if (!plan.ok || !scenario.ok) throw new Error(JSON.stringify([plan, scenario]));
  const r = prepareRun({ plan: plan.value, planFile: 'dummy-plan.yaml', scenario: { ...scenario.value, mistakes }, scenarioFile: 'dummy-scenario.yaml' });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.value;
}

function run(p: PreparedRun) {
  const r = runScenario(p, registry);
  if (r.outcome === 'invalid') throw new Error(JSON.stringify(r.problems));
  return r;
}

interface Pick {
  readonly t: number;
  readonly eligible: TraceValue | undefined;
  readonly picked: TraceValue | undefined;
}

function picks(r: ReturnType<typeof run>): Pick[] {
  return r.trace.events
    .filter((e) => e.kind === 'ai_event' && e.data.event === 'mark')
    .map((e) => ({ t: e.t, eligible: e.data.eligible, picked: e.data.picked }));
}

describe('runScenario', () => {
  it('runs the dummy scenario with observations and a limitation report', () => {
    const r = run(prepared());
    expect(r.outcome).toBe('timeout');
    expect(r.trace.events[0].kind).toBe('engage');
    expect(r.summary.observations.map((o) => o.pass)).toEqual([true, true]);
    expect(r.summary.limitations.standIns).toEqual(['h1', 'p3', 't1']);
    expect(r.summary.limitations.assumptions.map((a) => a.key)).toEqual(['core.ai_update_interval_ms', 'dummy.guess']);
    expect(r.summary.limitations.partialMechanics.map((m) => m.key)).toEqual(['dummy.cleave']);
    expect(picks(r).map((p) => p.t)).toEqual([12000, 24000]);
    expect(r.trace.meta.units.find((u) => u.id === 'p3')?.approximate).toBe(true);
  });

  it('is deterministic: same scenario and seed give byte-identical output (§11)', () => {
    const a = run(prepared());
    const b = run(prepared());
    expect(canonicalStringify(a.trace)).toBe(canonicalStringify(b.trace));
    expect(canonicalStringify(a.summary)).toBe(canonicalStringify(b.summary));
  });

  it('keeps boss selections while the eligible sets are equal (§8.7)', () => {
    const clean = picks(run(prepared()));
    const slow = picks(run(prepared([{ type: 'reaction', player: 'p3', minMs: 900, maxMs: 1500 }])));
    expect(slow).toHaveLength(clean.length);
    expect(slow[0].eligible).toEqual(clean[0].eligible);
    clean.forEach((c, i) => {
      if (canonicalStringify(c.eligible) === canonicalStringify(slow[i].eligible)) expect(slow[i].picked).toEqual(c.picked);
    });
  });

  it('a mistake that changes eligibility may legitimately change later selections', () => {
    const clean = picks(run(prepared()));
    const ruleMembers = ['p1', 'p2', 'p3', 'h1'];
    const runner = (clean[0].picked as readonly string[]).find((id) => ruleMembers.includes(id))!;
    const stay = picks(run(prepared([{ type: 'exclude_from_rule', rule: 'run-when-marked', player: runner }])));
    expect(stay[0]).toEqual(clean[0]);
    expect(clean[1].eligible).not.toContain(runner);
    expect(stay[1].eligible).toContain(runner);
  });

  it('returns invalid for an action without a handler or a spec without a model', () => {
    const withTaunt = `${PLAN_YAML}  - id: swap
    who: [p1]
    when: { on: time, atMs: 1000 }
    do: { do: taunt, target: boss }
`;
    const r = runScenario(prepared([], withTaunt), registry);
    expect(r.outcome).toBe('invalid');
    if (r.outcome === 'invalid') expect(r.problems.map((p) => p.message)).toContain('no handler for action taunt');
    const noSpec = runScenario(prepared(), { ...registry, policies: new Map() });
    expect(noSpec.outcome).toBe('invalid');
    if (noSpec.outcome === 'invalid') expect(noSpec.problems.map((p) => p.message)).toContain('no model for spec test_caster');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test packages/engine/test/run.test.ts`
Expected: FAIL, cannot resolve `../src/run`.

- [ ] **Step 4: Write `core-data.ts`**

`packages/engine/src/core-data.ts`:
```ts
import { PINS } from '@raid/data';

const commit = PINS.azerothcoreCommit;

/** Engine constants with provenance (§7). Validated by DataRegistry like every other value. */
export const CORE_DATA: readonly unknown[] = [
  {
    key: 'core.ai_update_interval_ms',
    value: 10,
    source: {
      kind: 'assumption',
      rationale:
        'AzerothCore default MapUpdateInterval is 10 ms (src/server/apps/worldserver/worldserver.conf.dist line 1330 at the pinned commit); the real update spacing on Rising-Gods depends on server load',
      confirmBy: 'Gate 2: spacing of boss timers in Rising-Gods combat logs',
    },
  },
  {
    key: 'core.sample_interval_ms',
    value: 100,
    source: { kind: 'configured', file: 'docs/superpowers/specs/2026-11-10-festergut-pilot-design.md' },
  },
  {
    key: 'core.player_run_speed_yd_s',
    value: 7,
    source: { kind: 'code', file: 'src/server/game/Entities/Unit/Unit.cpp', commit, line: 84 },
  },
  {
    key: 'core.player_combat_reach_yd',
    value: 1.5,
    source: { kind: 'code', file: 'src/server/game/Entities/Object/ObjectDefines.h', commit, line: 45 },
  },
  {
    key: 'core.player_bounding_radius_yd',
    value: 0.389,
    source: { kind: 'code', file: 'src/server/game/Entities/Object/ObjectDefines.h', commit, line: 44 },
  },
];
```

- [ ] **Step 5: Write `run.ts`**

`packages/engine/src/run.ts`:
```ts
import { DataRegistry, DataValidationError, PINS, type Difficulty } from '@raid/data';
import { attachBoss, victimOf, type BossScript } from './boss';
import { installCoreRules } from './casting';
import { ActorController, type ActorPolicy } from './controller';
import { CORE_DATA } from './core-data';
import { collectLimitations } from './limitations';
import { evaluateObservations, type CustomCheck } from './observations';
import type { PreparedRun } from './plan/prepare';
import type { ModelledMember } from './plan/schema';
import type { LoadProblem } from './plan/validate';
import { BUILTIN_ACTIONS, RuleEngine, type ActionHandler } from './rules';
import { Simulation, type OutcomeKind } from './sim';
import { installStandin } from './standin';
import { buildSummary, type Summary } from './summary';
import type { Trace } from './trace';
import type { Role, UnitInit } from './units';

export const ENGINE_VERSION = '0.1.0';

export interface PolicyFactory {
  readonly spec: string;
  readonly role: Exclude<Role, 'boss' | 'add'>;
  create(args: { readonly sim: Simulation; readonly member: ModelledMember; readonly data: DataRegistry }): {
    readonly unit: Pick<UnitInit, 'maxHealth' | 'speedYdPerSec' | 'combatReach' | 'boundingRadius'>;
    readonly policy: ActorPolicy;
  };
}

export interface BossSetup {
  readonly script: BossScript;
  readonly bossUnitId: string;
  /** Sets initial aggro once every player exists. */
  pull(sim: Simulation): void;
}

export interface BossModule {
  readonly id: string;
  readonly data: readonly unknown[];
  readonly overrides: readonly unknown[];
  setup(args: { readonly sim: Simulation; readonly data: DataRegistry; readonly difficulty: Difficulty }): BossSetup;
}

export interface ContentRegistry {
  readonly bosses: ReadonlyMap<string, BossModule>;
  readonly policies: ReadonlyMap<string, PolicyFactory>;
  readonly actions: ReadonlyMap<string, ActionHandler>;
  readonly checks: ReadonlyMap<string, CustomCheck>;
}

export type RunResult =
  | { readonly outcome: 'invalid'; readonly problems: readonly LoadProblem[] }
  | { readonly outcome: OutcomeKind; readonly trace: Trace; readonly summary: Summary };

function checkContent(p: PreparedRun, reg: ContentRegistry): LoadProblem[] {
  const problems: LoadProblem[] = [];
  if (!reg.bosses.has(p.plan.boss)) problems.push({ file: p.planFile, path: 'boss', message: `unknown boss ${p.plan.boss}` });
  p.plan.roster.forEach((m, i) => {
    if (m.kind === 'modelled' && !reg.policies.has(m.spec)) {
      problems.push({ file: p.planFile, path: `roster.${i}.spec`, message: `no model for spec ${m.spec}` });
    }
  });
  p.plan.rules.forEach((r, i) => {
    if (!BUILTIN_ACTIONS.has(r.do.do) && !reg.actions.has(r.do.do)) {
      problems.push({ file: p.planFile, path: `rules.${i}.do.do`, message: `no handler for action ${r.do.do}` });
    }
  });
  p.scenario.observation.checks.forEach((c, i) => {
    if (c.check === 'custom' && !reg.checks.has(c.name)) {
      problems.push({ file: p.scenarioFile, path: `observation.checks.${i}.name`, message: `unknown custom check ${c.name}` });
    }
  });
  return problems;
}

export function runScenario(prepared: PreparedRun, registry: ContentRegistry): RunResult {
  const problems = checkContent(prepared, registry);
  if (problems.length > 0) return { outcome: 'invalid', problems };
  const { scenario, plan } = prepared;
  const boss = registry.bosses.get(plan.boss)!;

  let data: DataRegistry;
  try {
    data = new DataRegistry([...CORE_DATA, ...boss.data], boss.overrides, scenario.profile);
  } catch (e) {
    if (e instanceof DataValidationError) {
      return { outcome: 'invalid', problems: e.problems.map((message) => ({ file: `boss:${boss.id}`, path: '(data)', message })) };
    }
    throw e;
  }

  const sim = new Simulation({
    seed: scenario.seed,
    maxDurationMs: scenario.maxDurationMs,
    sampleIntervalMs: data.num('core.sample_interval_ms'),
  });
  installCoreRules(sim);
  const setup = boss.setup({ sim, data, difficulty: scenario.difficulty });
  const rules = new RuleEngine(sim, plan, new Map([...BUILTIN_ACTIONS, ...registry.actions]), {
    currentTank: () => victimOf(sim, setup.bossUnitId),
  });
  const hooks = {
    isRuleMoving: (id: string) => rules.isMoving(id),
    spots: () => plan.spots,
    assignment: (id: string) => rules.assignment(id),
  };
  const playerBody = {
    speedYdPerSec: data.num('core.player_run_speed_yd_s'),
    combatReach: data.num('core.player_combat_reach_yd'),
    boundingRadius: data.num('core.player_bounding_radius_yd'),
  };

  const controllers: ActorController[] = [];
  for (const m of plan.roster) {
    const pos = plan.spots[rules.assignment(m.id)!];
    if (m.kind === 'modelled') {
      const factory = registry.policies.get(m.spec)!;
      const made = factory.create({ sim, member: m, data });
      sim.addUnit({ ...made.unit, id: m.id, name: m.name, kind: 'player', role: factory.role, pos });
      controllers.push(new ActorController(sim, m.id, made.policy, hooks));
    } else {
      sim.addUnit({ ...playerBody, id: m.id, name: m.name, kind: 'player', role: m.role, approximate: true, maxHealth: m.maxHealth, pos });
    }
  }
  setup.pull(sim);
  rules.install();
  for (const c of controllers) c.install();
  for (const m of plan.roster) if (m.kind === 'standin') installStandin(sim, m);
  const aiUpdateIntervalMs = data.num('core.ai_update_interval_ms');
  attachBoss(sim, setup.script, setup.bossUnitId, aiUpdateIntervalMs);
  const outcome = sim.run();

  const trace = sim.trace.build({
    engineVersion: ENGINE_VERSION,
    azerothcoreCommit: PINS.azerothcoreCommit,
    spellDataVersions: [...PINS.spellDataVersions],
    scenario: scenario.id,
    boss: plan.boss,
    difficulty: scenario.difficulty,
    seed: scenario.seed,
    profile: scenario.profile,
    aiUpdateIntervalMs,
    sampleIntervalMs: sim.options.sampleIntervalMs,
    units: sim.sortedUnits().map((u) => ({ id: u.id, name: u.name, kind: u.kind, role: u.role, approximate: u.approximate })),
  });
  const observations = evaluateObservations(scenario.observation.checks, trace, registry.checks);
  const summary = buildSummary(trace, collectLimitations(sim, data, [setup.script]), observations);
  return { outcome: outcome.kind, trace, summary };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/run.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Run the whole engine suite**

Run: `pnpm test packages/engine`
Expected: PASS, all engine test files.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/core-data.ts packages/engine/src/run.ts packages/engine/test/fixtures packages/engine/test/run.test.ts
git commit -m "feat(engine): scenario runner with content registry, sourced core data and determinism tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Engine entry point and the English formatter

Readable text is produced only here (D6). The formatter reads the canonical trace and never changes it.

**Files:**
- Create: `packages/engine/src/index.ts`
- Create: `packages/format/src/en.ts`, `packages/format/src/format.ts`, `packages/format/src/index.ts`
- Test: `packages/format/test/format.test.ts`

- [ ] **Step 1: Write the engine entry point**

`packages/engine/src/index.ts`:
```ts
export * from './auras';
export * from './boss';
export * from './casting';
export * from './catalog';
export * from './controller';
export * from './core-data';
export * from './effects';
export * from './eventmap';
export * from './limitations';
export * from './movement';
export * from './observations';
export * from './plan/mistakes';
export * from './plan/prepare';
export * from './plan/schema';
export * from './plan/validate';
export * from './queue';
export * from './rng';
export * from './rules';
export * from './run';
export * from './sim';
export * from './standin';
export * from './summary';
export * from './trace';
export * from './units';
export * from './view';
```

- [ ] **Step 2: Write the failing test**

`packages/format/test/format.test.ts`:
```ts
import { EventClass, Simulation, canonicalStringify, type Trace } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { EN } from '../src/en';
import { clock, formatLog } from '../src/format';

function trace(): Trace {
  const sim = new Simulation({ seed: 1, maxDurationMs: 2000, sampleIntervalMs: 1000 });
  const body = { speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389, pos: { x: 0, y: 0 } };
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1000000 });
  sim.addUnit({ ...body, id: 'p1', name: 'Alice', kind: 'player', role: 'ranged', maxHealth: 1000 });
  sim.emit('engage', { boss: 'boss' });
  sim.at(1500, EventClass.SpellHit, () => void sim.damage('p1', 300, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
  sim.run();
  return sim.trace.build({
    engineVersion: 'test',
    azerothcoreCommit: 'x',
    spellDataVersions: [],
    scenario: 's',
    boss: 'boss',
    difficulty: '25n',
    seed: 1,
    profile: 'azerothcore',
    aiUpdateIntervalMs: 10,
    sampleIntervalMs: 1000,
    units: sim.sortedUnits().map((u) => ({ id: u.id, name: u.name, kind: u.kind, role: u.role, approximate: u.approximate })),
  });
}

describe('formatter', () => {
  it('formats the clock as mm:ss.mmm', () => {
    expect(clock(0)).toBe('00:00.000');
    expect(clock(61234)).toBe('01:01.234');
  });

  it('renders unit names and ability names from the dictionary', () => {
    const lines = formatLog(trace(), EN, { 'ability.smash': 'Smash' });
    expect(lines).toEqual(['[00:00.000] Boss engaged', '[00:01.500] Boss Smash hits Alice for 300', '[00:02.000] Outcome: timeout']);
  });

  it('changing the locale does not change the canonical trace (D6)', () => {
    const t = trace();
    const before = canonicalStringify(t);
    const english = formatLog(t, EN, {});
    const other = formatLog(t, { ...EN, 'event.damage': '{target} <- {ability} ({amount})' }, {});
    expect(other).not.toEqual(english);
    expect(canonicalStringify(t)).toBe(before);
    expect(canonicalStringify(trace())).toBe(before);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test packages/format`
Expected: FAIL, cannot resolve `../src/en`.

- [ ] **Step 4: Write the formatter**

`packages/format/src/en.ts`:
```ts
export type Dictionary = Readonly<Record<string, string>>;

/** English templates per event kind. Ability names come from content dictionaries (`ability.<id>`). */
export const EN: Dictionary = {
  'event.engage': '{boss} engaged',
  'event.ai_event': '{boss}: {event}',
  'event.cast_start': '{caster} begins casting {spell} → {target}',
  'event.cast_success': '{caster} casts {spell} → {target}',
  'event.cast_failed': '{caster} fails to cast {spell} ({reason})',
  'event.cast_interrupted': '{unit} is interrupted casting {spell} ({reason})',
  'event.spell_hit': '{spell} hits {target}',
  'event.damage': '{source} {ability} hits {target} for {amount}',
  'event.heal': '{source} {ability} heals {target} for {amount}',
  'event.aura_applied': '{unit} gains {aura}',
  'event.aura_stack': '{unit} gains {aura} ({stacks})',
  'event.aura_removed': '{aura} fades from {unit} ({reason})',
  'event.periodic_tick': '{aura} ticks on {unit}',
  'event.move_start': '{unit} starts moving',
  'event.move_end': '{unit} stops moving',
  'event.rule_fired': '{actor} reacts: {rule}',
  'event.action_failed': '{actor} fails {action} ({reason})',
  'event.phase_change': 'Phase: {phase}',
  'event.timer_window': '{ability} expected between {earliestMs} and {latestMs}',
  'event.death': '{unit} dies',
  'event.outcome': 'Outcome: {kind}',
};
```

`packages/format/src/format.ts`:
```ts
import type { Trace, TraceEvent, TraceValue } from '@raid/engine';
import type { Dictionary } from './en';

const UNIT_KEYS = new Set(['boss', 'caster', 'target', 'unit', 'source', 'actor']);
const ABILITY_KEYS = new Set(['spell', 'ability', 'aura']);

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export function clock(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(m, 2)}:${pad(s, 2)}.${pad(ms % 1000, 3)}`;
}

export function createFormatter(trace: Trace, dict: Dictionary): (ev: TraceEvent) => string {
  const names = new Map(trace.meta.units.map((u) => [u.id, u.name]));
  const render = (key: string, v: TraceValue | undefined): string => {
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) return v.map((x) => render(key, x as string)).join(', ');
    if (typeof v === 'string' && UNIT_KEYS.has(key)) return names.get(v) ?? v;
    if (typeof v === 'string' && ABILITY_KEYS.has(key)) return dict[`ability.${v}`] ?? v;
    if (typeof v === 'number' && key.endsWith('Ms')) return clock(v);
    return String(v);
  };
  return (ev) => {
    const template = dict[`event.${ev.kind}`] ?? ev.kind;
    const text = template.replace(/\{(\w+)\}/g, (_m, key: string) => render(key, ev.data[key]));
    return `[${clock(ev.t)}] ${text}`;
  };
}

/** Readable event log; `extra` adds content names such as `ability.gas_spore`. */
export function formatLog(trace: Trace, dict: Dictionary, extra: Dictionary): string[] {
  const format = createFormatter(trace, { ...dict, ...extra });
  return trace.events.map(format);
}
```

`packages/format/src/index.ts`:
```ts
export * from './en';
export * from './format';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test packages/format`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/index.ts packages/format
git commit -m "feat(format): English event log formatter outside the canonical trace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Full verification

- [ ] **Step 1: Run every test**

Run: `pnpm test`
Expected: PASS, 18 test files, 0 failures.

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`
Expected: no output, exit code 0. Fix every reported error before continuing; do not loosen `tsconfig.json`.

- [ ] **Step 3: Check the dependency rule**

Run: `grep -rnE "from '(\.\./)+(bosses|classes|cli|format)|@raid/format" packages/engine/src || echo "engine clean"`
Expected: `engine clean`.

- [ ] **Step 4: Check that no value lacks a source**

Run: `grep -rn "value:" packages/engine/src/core-data.ts | wc -l && grep -rn "source:" packages/engine/src/core-data.ts | wc -l`
Expected: the two counts are equal (5 and 5).

- [ ] **Step 5: Commit any fixes**

```bash
git status --short
git add -A packages docs
git commit -m "chore: engine contract verified

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Skip the commit if `git status --short` printed nothing.

---

## Spec coverage of this plan

| Spec item | Task |
| --- | --- |
| D2 baseline and overrides kept apart | 3 |
| D4 deterministic, UI-free engine | 4–18 |
| D6 canonical output without text; formatter separate | 7, 19 |
| D8 GPL-2.0 | 0 |
| §5 pinned sources, spell-data version gate | 1, 2, 3 |
| §5.1 core semantics (timers while casting, one event per update, delays, interval as assumption) | 6, 12, 18 |
| §6.1 separate mechanics and validation status | 12 (`MechanicStatus`) |
| §6.3 stand-ins | 16, 18 |
| §6.4 run-level limitation report | 17, 18 |
| §7 seven provenance kinds, unsourced values rejected | 2, 3, 18 |
| §8.1 event-driven time, sampling | 5, 9 |
| §8.2 same-millisecond order, death before later heals | 5, 9, 10 |
| §8.3 continuous movement, edge distances | 8, 9 |
| §8.4 action eligibility and wake-ups (except resource gains) | 11, 13 |
| §8.5 rule priority, edge triggers, cooldown, failures, retry | 15 |
| §8.6 actor knowledge | 13 |
| §8.7 per-mechanic and per-actor streams, narrowed guarantee | 4, 12, 18 |
| §9 trace with stable ids and causes, summary, outcomes incl. timeout and invalid | 7, 17, 18 |
| §10.2 plan format and rule vocabulary | 14 |
| §10.3 scenarios with mistakes and intended observations | 14, 17 |
| §11 boundary tests (area radius, same-ms expiry and damage, interrupted cast), determinism, randomness, locale | 6, 9, 10, 11, 18, 19 |

## Left to Plan 2 and Plan 3

| Spec item | Plan |
| --- | --- |
| Spell-data source decision (fills `PINS.spellDataVersions`) | 2, first task |
| Threat model, `taunt` action, boss melee swings, tank-swap boundary test | 2 |
| Festergut script and data, ambient blight variants, Gas Spore/Inoculated, Pungent Blight, Gastric Bloat, Vile Gas, berserk | 2 |
| Gate 1 scenarios with custom observation checks, scenario and ability text keys in English | 2 |
| Node CLI `raid-sim run`, file loading, writing trace, log and summary | 2 |
| Golden runs of the Gate 1 scenarios | 2 |
| Stats, resources, hit/crit, armor and avoidance, raid buffs (including stand-in buffs), consumables | 3 |
| Resource-gain wake-ups (§8.4), `use_cooldown` action | 3 |
| Protection Paladin, Restoration Druid, Fire Mage with `SUPPORT.md` (§6.2) | 3 |
| Worked examples for spell damage and armor mitigation (§11) | 3 |
