# Plan 2b-2 — The Festergut Encounter (Gate 1, Plan 2 of 3, part b-2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Festergut, Icecrown Citadel, 25-player normal, as a runnable encounter: a boss module in `@raid/content` whose spells and auras are built from the extracted client spell data, whose creature values come from the pinned world database and whose timers come from `boss_festergut.cpp`; the boss script with its spell and aura scripts; the delayed first gas; a 25-player raid plan; the three Gate 1 scenarios (clean kill, missed spore group, late tank swap) with automatic observation checks; English names; golden runs; and `corepack pnpm sim run scenarios/festergut/<name>.yaml`.

**Architecture:** `packages/content/src/festergut/` holds the module: `spell-ids.ts` (engine ids, difficulty variants), `data.ts` (sourced values), `spells.ts` (catalog from data), `ai.ts` (the EventMap script and mechanic statuses), `scripts/` (Pungent Blight, Blighted Spores, Gastric Bloat), `boss.ts` (the `BossModule`), `checks.ts` (observation checks), `text.ts` (English). `packages/content/src/generic/` adds two ability-using stand-ins (a caster and a healer) built on the existing policy and controller system. The engine gets three small additions: the EventMap time-until query with timer-window helpers on `EventScriptedAI`, a flag that marks generic role actors as approximate, and two missing exports. Scenarios live in `scenarios/festergut/`.

**Tech Stack:** as Plans 2a and 2b-1; no new dependencies. `tsconfig.json` gains `resolveJsonModule` so the content can import the spell data file.

**Spec:** `docs/superpowers/specs/2026-11-10-festergut-pilot-design.md` (rev. 2; §4 Gate 1, §6 accuracy contract, §7 provenance, §10 encounter and scenarios, §11 testing). **Research:** `docs/research/festergut-mechanics-25n.md`, `docs/research/festergut-azerothcore.md`. **Notes:** `docs/superpowers/plans/2026-11-12-notes-for-plan-2b2.md` (binding). **Contract list:** `docs/superpowers/plans/2026-11-10-contract-changes-for-plans-2-3.md`.

**Verified:** every code block of this plan was built and run in a scratch copy of the repository at commit `5959465` (branch `feat/plan-2b2`) before the plan was written: the suite, the type check and the three scenarios pass there with exactly this code. The numbers quoted in tests and expected outputs come from those runs.

---

## Conventions

As Plan 2b-1:
- Run from `E:\raid-explainer` in Git Bash. Start each shell with `pnpm() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm "$@"; }` (pnpm is only ever run as `corepack pnpm …`).
- All files are UTF-8 (the code contains `–`, `×`, `→`, `§`).
- TDD: write the failing test, run it and watch it fail, implement, run it and watch it pass, commit.
- Before every commit run `pnpm test && pnpm typecheck && pnpm golden`. Expected: every test passes, no type errors, `all golden runs match`.
- Commit messages end with a blank line and `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Changing an existing file: read it first; the snippets show the exact text to replace or the text after which to add. Keep everything else unchanged.
- **Canonical traces.** The fingerprint of `scenarios/training-dummy/clean.yaml` in `scenarios/golden.json` and the pinned fingerprint in `packages/engine/test/run.test.ts` must not change in any task. If `pnpm golden` reports a change, stop and find the cause. The three Festergut fingerprints are added deliberately in the last task.
- Test counts given as "Expected: PASS (n tests)" refer to the named file. The suite has 534 tests before Task 1.
- AzerothCore line numbers refer to the pinned commit `dca1a87699e380f3c19af54f9003d837c696131d`. Short names: `FG` = `src/server/scripts/Northrend/IcecrownCitadel/boss_festergut.cpp`, `PP` = `…/IcecrownCitadel/boss_professor_putricide.cpp`, `ICC.h` = `…/IcecrownCitadel/icecrown_citadel.h`, `SQL/<table>` = `data/sql/base/db_world/<table>.sql`.

## Sources read for this plan (file and line of every value)

**Script timers and constants (`FG`):** berserk 5 min (123); Inhale Blight first 25–30 s (124); Gas Spore first 20–25 s (125); Vile Gas first 30–40 s in group 1 (126); Gastric Bloat first 12.5–15 s (127); Putricide's `ACTION_FESTERGUT_COMBAT` (137–138); `RemoveBlight` (170–178); the event switch (190–249): Berserk 47008 triggered (193; `SPELL_BERSERK2`, `ICC.h` 48), the inhale counter limit 3 (198, 211), Pungent Blight not triggered (202), Gas Spore rescheduled 20–25 s (204), Inhale Blight not triggered (208), next gas triggered (212; ids at 63), inhale every 34 s (215), Gas Spore with `SPELLVALUE_MAX_TARGETS` 2/3/2/3 (220), repeat 40–45 s (221), `DelayEventsToMax(20s, 1)` (222), Vile Gas `minTargets` 3/8/3/8 (227), distance −5 (228–231), repeat 28–35 s in group 1 (235), Gastric Bloat on the victim (239), repeat 15–17.5 s (240); `SetData`/`GetData` (254–266; `DATA_INOCULATED_STACK` 66); Pungent Blight script (275–313); Blighted Spores aura script (315–347: 1 s rule 327, 10 s rule 334, Inoculated cast 337, `SetData` 338–340); Gastric Bloat script (349–372: 10 stacks 361, remove 364, explosion 365).

**Putricide (`PP`):** watch position (4324.820, 3166.03, 389.3831) (150); table position (152); `MovementInform` → Festergut casts 69157 (425–433); `MoveCharge(…, 15.0f, POINT_FESTERGUT)` (472–474).

**World database:**

| Value | Row | Source |
| --- | --- | --- |
| 25n entry is 37504 | `creature_template` 36626, `difficulty_entry_1` | `SQL/creature_template` line 28379 |
| minlevel 83, exp 2, speed_run 1.5873, DamageModifier 122.6, **BaseAttackTime 0**, BaseVariance 1, unit_class 1, HealthModifier 2900, ArmorModifier 1 | `creature_template` 37504 | `SQL/creature_template` line 28891 |
| basehp2 13945, basearmor 10643, attackpower 805, damage_exp2 177.074 | `creature_classlevelstats` (83, 1) | `SQL/creature_classlevelstats` line 381 |
| display 31006, DisplayScale 1 | `creature_template_model` 37504 | `SQL/creature_template_model` line 38525 |
| BoundingRadius 0.31, CombatReach 8 | `creature_model_info` 31006 | `SQL/creature_model_info` line 23955 |
| Festergut spawn (4267.92, 3137.26, 360.593) | `creature` guid 201255 | `SQL/creature` line 138459 |
| Putricide spawn (4356.19, 3262.9, 389.482) | `creature` guid 201294 | `SQL/creature` line 138470 |

**A correction to the research notes:** `festergut-azerothcore.md` says "BaseAttackTime 2000". The database row stores **0** in `BaseAttackTime` (column 23) and 2000 in `RangeAttackTime` (column 24). The core replaces a `BaseAttackTime` of 0 by `BASE_ATTACK_TIME` when it checks the template (`src/server/game/Globals/ObjectMgr.cpp` 1133–1134), and `BASE_ATTACK_TIME` is 2000 (`src/server/game/Entities/Unit/Unit.h` 43). The attack time is therefore 2000 ms, but its source is the core default, not the database; Task 4 records both.

**Core:** `EventMap::GetTimeUntilEvent` and `HasTimeUntilEvent` (`src/common/Utilities/EventMap.cpp` 200–212); `Creature::SetSpeed(MOVE_RUN, speed_run)` (`Creature.cpp` 563); attribute bits in `src/server/shared/SharedDefines.h`: `SPELL_ATTR0_ALLOW_CAST_WHILE_DEAD` 0x00800000 (393), `SPELL_ATTR1_EXCLUDE_CASTER` 0x00080000 (426), `SPELL_ATTR2_ALLOW_DEAD_TARGET` 0x00000001 (444), `SPELL_ATTR3_ONLY_ON_PLAYER` 0x00000100 (489), `SPELL_ATTR3_ALWAYS_HIT` 0x00040000 (499), `SPELL_ATTR3_ALLOW_AURA_WHILE_DEAD` 0x00100000 (501), `SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS` 0x20000000 (621). No value in this plan is taken from memory; nothing had to be marked `assumption` for Festergut himself.

## Design decisions (binding)

1. **Engine ids are names, independent of the difficulty** (`pungent_blight`, `gastric_bloat`, …). `FestergutSpells` maps each name to its base spell id, resolves the difficulty variant with `SpellVariants` (25n: 71219, 72551, …) and maps any numeric id of a row back to the name. Plan rules, texts and traces use the names; data keys use the numeric variant (`spell.71219.e0.min`). This is the "numeric id → engine id mapping reachable from hooks" of the notes: scripts receive the `FestergutSpells` object.
2. **Every catalog value is read through the registry.** `data.ts` puts all fields of the 18 variant spells into the module's data with `spellDataEntries` (`spelldata` sources, effect ranges `derived`), the creature values as `db` entries whose key names row, column, SQL file and line, the script's timers as `code` entries with their line, and computed values (health, armor, melee range, first gas delay) as `derived`. `spells.ts` and `ai.ts` only call `data.num(...)`; attribute flags and trigger links are read from the data too.
3. **Effect positions equal Spell.dbc effect indices** wherever a script hooks an effect (Pungent Blight 0 and 1, Gastric Bloat 2).
4. **Left out, each listed in the mechanic statuses** (notes): the FORCE_CAST gas visuals on NPC 36659, Gas Spore's DUMMY aura (effect 1, radius 0), Inoculated's PERIODIC_DUMMY, Vile Gas's LINKED aura 69248, its missile delay and the splash's root; spell hit and resist; crits of Gastric Explosion; the tick restart on a Vile Gas refresh (A-009). Malleable Goo is heroic only and not part of this plan.
5. **Hook casts have no original caster.** Inoculated (from the Blighted Spores aura script) and Gastric Explosion (from the Gastric Bloat spell script) are cast with `startCast(sim, unit, spell, unit, causes, { triggered: true })` (A-020), so the player owns the damage and the creature area-damage avoidance does not apply.
6. **Script state reached from hooks ("Flu Shot Shortage").** Aura hooks only get `sim`. The module's `setup` creates the `FestergutAI` object first and passes it to the script factories; the Blighted Spores script calls `ai.setData(DATA_INOCULATED_STACK, stack)`, mirroring `festergut->AI()->SetData(...)` (`FG` 338–340). `BossContext.setData` is not used: it is not reachable from a hook.
7. **The first gas is a script timer, not an EventMap event.** Putricide is not a unit. The delay is a `derived` value: his 3D distance from spawn to watch position (101.82 yd) at 15 yd/s, truncated: 6788 ms. `FestergutAI.updateAI` counts it down before the EventMap step, so a running cast does not hold it back; with the 10 ms AI interval it fires at 6790 ms (A-036).
8. **Timer windows never go stale (open contract item).** `EventMap` gets `timeUntilEvent` and `hasTimeUntilEvent` (AzerothCore's `GetTimeUntilEvent`/`HasTimeUntilEvent`). `EventScriptedAI.publishWindow` checks every window it publishes against the EventMap and throws if the event is not inside it; `raiseWindow` moves both bounds up to a floor after `delayEventsToMax` (all a boss mod could know, spec §8.6: the hidden time itself is never published) and clears the window of an event that is no longer scheduled. Both do nothing once the fight is over, which also answers contract item 14 for this script: its other emits (`ctx.ai`) happen before the action that could end the fight.
9. **25n only.** `festergut.setup` rejects other difficulties (the run is `invalid`); the data is built for 25n. Gate 4 adds the rest.
10. **Players: who is what (spec §6.3, owner's requirement).** The engine has no class specs yet (Plan 3: resources, haste, crits, coefficients, class spell data). What it has is the policy and controller system (cast time, global cooldown, range, interruption by movement, decision wake-ups) and rate stand-ins. This plan therefore uses:
    - **healers and ranged damage dealers as ability users**: `generic_healer` casts a 1.5 s heal on the player who needs it most (lowest health percentage, tanks first when low, counting heals already being cast), `generic_caster` casts a 2 s bolt at the boss. Both stop while moving and lose a cast that movement interrupts. They are **not** specs: their numbers are `assumption` entries and their units are marked `approximate` (new `PolicyFactory.approximate`), so the limitation report lists them as stand-ins.
    - **tanks and melee as rate stand-ins** (`kind: standin`): the engine has no player melee swings, and taunting is a plan rule.
    - So **all 25 raid members are stand-ins** in the sense of §6.3 and every run says so. The three Gate 1 specs (Protection Paladin, Restoration Druid, Fire Mage) replace `t1`, one healer and one ranged in Plan 3; the scenario files then only change those roster lines.
11. **The raid's strategy is written with the existing rule vocabulary:** on Gas Spore's cast everyone at range runs to the melee group (so all three spores explode on the whole raid: one Inoculated stack per round); when Blighted Spores lands they run back out, before Vile Gas (which Gas Spore delays by 20 s); the second tank taunts when the first has nine Gastric Bloat stacks. Two healers stand with the melee group and never move. No new trigger or action is needed.
12. **Observation checks:** built-in checks where they suffice; four custom checks in `CONTENT.checks` for what they cannot say (no player died; Inoculated stacks at each Pungent Blight; the missing player compared with the rest; the late swap's cause chain, contract item 11).
13. **The stand-in tank profile stands for cooldowns.** At three Inhaled Blight stacks Festergut swings every 1.05 s for up to 150,529 before armor. Rate stand-ins have no cooldowns, so the plan's tank profile (95,000 health, armor at the 75 % cap, 57 % avoidance) carries what a real tank would add with cooldowns and block. It is `configured` in the plan file and reported with the stand-ins; the clean kill is pinned to seed 1 (seeds 1 and 3–8 kill without a player death in the prototype; seed 2 loses the first tank at 1:22).

## File map (new and changed)

```
docs/sources.md, docs/adaptations.md, docs/superpowers/plans/2026-11-10-contract-changes-for-plans-2-3.md   (updated)
tsconfig.json                                         resolveJsonModule
packages/engine/src/eventmap.ts                       timeUntilEvent, hasTimeUntilEvent
packages/engine/src/boss.ts                           EventScriptedAI.publishWindow, raiseWindow
packages/engine/src/run.ts                            PolicyFactory.approximate
packages/engine/src/index.ts                          exports melee and modifiers
packages/engine/test/timer-windows.test.ts, approximate-actors.test.ts            (new)
packages/content/src/generic/caster.ts, healer.ts     ability-using stand-ins (new)
packages/content/src/festergut/spell-ids.ts, data.ts, spells.ts, ai.ts, boss.ts, checks.ts, text.ts   (new)
packages/content/src/festergut/scripts/pungent-blight.ts, blighted-spores.ts, gastric-bloat.ts        (new)
packages/content/src/index.ts                         registry and texts
packages/content/test/generic-actors.test.ts          (new)
packages/content/test/festergut/*.test.ts, fight.ts, scenario.ts                   (new)
packages/cli/test/festergut-cli.test.ts               (new)
scenarios/festergut/plan-25n.yaml, clean-kill.yaml, missed-spore-group.yaml, late-tank-swap.yaml   (new)
scenarios/golden.json                                 three new fingerprints
```

---

### Task 0: Sources for the new values

**Files:** Modify `docs/sources.md`.

- [ ] **Step 1: Append these rows to the "Files referenced so far" table in `docs/sources.md`:**

```markdown
| `src/common/Utilities/EventMap.cpp` lines 200–212 | GetTimeUntilEvent, HasTimeUntilEvent (`eventmap.ts`, timer windows in `boss.ts`) |
| `src/server/scripts/Northrend/IcecrownCitadel/boss_festergut.cpp` lines 48–66, 114–139, 170–267, 275–372 | Festergut's spells, engage schedule, event switch, SetData, spell and aura scripts (`packages/content/src/festergut/`) |
| `src/server/scripts/Northrend/IcecrownCitadel/boss_professor_putricide.cpp` lines 150–152, 425–433, 472–474 | Putricide's run to his Festergut watch position and the first Gaseous Blight (`festergut/data.ts`, `ai.ts`) |
| `src/server/scripts/Northrend/IcecrownCitadel/icecrown_citadel.h` lines 48, 266–267, 276, 552–554 | Berserk 47008, creature entries, Festergut actions |
| `src/server/game/Globals/ObjectMgr.cpp` lines 1133–1134; `src/server/game/Entities/Unit/Unit.h` line 43 | A BaseAttackTime of 0 becomes BASE_ATTACK_TIME (2000 ms) |
| `src/server/game/Entities/Creature/Creature.cpp` line 563 | Creature run speed from `speed_run` |
| `src/server/shared/SharedDefines.h` lines 393, 426, 444, 489, 499, 501, 621 | Attribute bits read from the spell data (`festergut/spells.ts`) |
| `data/sql/base/db_world/creature_template.sql` lines 28379, 28891; `creature_classlevelstats.sql` line 381; `creature_template_model.sql` line 38525; `creature_model_info.sql` line 23955; `creature.sql` lines 138459, 138470 | Festergut 25n creature values, model size, spawn; Putricide's spawn (`festergut/data.ts`) |
```

- [ ] **Step 2: Commit**

```bash
git add docs/sources.md
git commit -m "docs: sources for the Festergut encounter

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 1: EventMap time-until query and timer windows that cannot go stale (contract item 8, adds A-034)

The Festergut script delays Vile Gas when Gas Spore is cast (`FG` 222) and reschedules Gas Spore at Pungent Blight (`FG` 204). A window published earlier would then be wrong. AzerothCore's EventMap has `GetTimeUntilEvent` (EventMap.cpp 200–207: the time of the first scheduled event with the id, or `Milliseconds::max()`) and `HasTimeUntilEvent` (209–212). The engine gets both, and `EventScriptedAI` gets two helpers built on them (design decision 8).

**Files:**
- Create: `packages/engine/test/timer-windows.test.ts`
- Modify: `packages/engine/src/eventmap.ts`, `packages/engine/src/boss.ts`, `docs/adaptations.md`, `docs/superpowers/plans/2026-11-10-contract-changes-for-plans-2-3.md`

**Changed behaviour:** none for existing scripts (they call `ctx.publishTimer` directly, which stays).

- [ ] **Step 1: Write the failing test** `packages/engine/test/timer-windows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EventScriptedAI, attachBoss, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { EventMap } from '../src/eventmap';
import { RngRegistry } from '../src/rng';
import { Simulation } from '../src/sim';
import { ThreatManager } from '../src/threat';

const newMap = () => new EventMap(new RngRegistry(1).stream('test.timers'));

describe('EventMap time-until query (GetTimeUntilEvent, EventMap.cpp 200–212)', () => {
  it('gives the time until the earliest event with the id, or null', () => {
    const m = newMap();
    expect(m.timeUntilEvent(1)).toBeNull();
    expect(m.hasTimeUntilEvent(1)).toBe(false);
    m.schedule(1, 5000);
    m.schedule(1, 2000);
    m.schedule(2, 3000);
    m.update(500);
    expect(m.timeUntilEvent(1)).toBe(1500);
    expect(m.timeUntilEvent(2)).toBe(2500);
    expect(m.hasTimeUntilEvent(2)).toBe(true);
  });

  it('follows delays, reschedules and execution', () => {
    const m = newMap();
    m.schedule(1, 1000, 1);
    m.delayEventsToMax(4000, 1);
    expect(m.timeUntilEvent(1)).toBe(4000);
    m.reschedule(1, 700);
    expect(m.timeUntilEvent(1)).toBe(700);
    m.update(900);
    expect(m.timeUntilEvent(1)).toBe(-200);
    expect(m.execute()).toBe(1);
    expect(m.timeUntilEvent(1)).toBeNull();
  });
});

const EVENT_A = 1;
const EVENT_B = 2;
const GROUP_B = 1;

/** A: every 10 s, delays group 1 to at least 8 s. B: first after 12 to 15 s. */
class WindowAI extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [];
  constructor(private readonly mode: 'ok' | 'wrong_window' | 'cancel_b') {
    super();
  }
  protected engage(ctx: BossContext): void {
    this.events.schedule(EVENT_A, 10000);
    this.publishWindow(ctx, 'a', EVENT_A, 10000, 10000, []);
    this.events.scheduleRange(EVENT_B, 12000, 15000, GROUP_B);
    if (this.mode === 'wrong_window') this.publishWindow(ctx, 'b', EVENT_B, 20000, 30000, []);
    else this.publishWindow(ctx, 'b', EVENT_B, 12000, 15000, []);
  }
  protected executeEvent(id: number, ctx: BossContext): void {
    const ev = ctx.ai(id === EVENT_A ? 'a' : 'b');
    if (id !== EVENT_A) return;
    if (this.mode === 'cancel_b') this.events.cancel(EVENT_B);
    this.events.delayEventsToMax(8000, GROUP_B);
    this.raiseWindow(ctx, EVENT_B, 8000, [ev]);
    this.events.schedule(EVENT_A, 10000);
    this.publishWindow(ctx, 'a_again', EVENT_A, 10000, 10000, [ev]);
  }
}

function run(mode: 'ok' | 'wrong_window' | 'cancel_b') {
  const sim = new Simulation({ seed: 3, maxDurationMs: 19000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e6, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 5, boundingRadius: 2 });
  sim.addUnit({ id: 'p1', name: 'p1', kind: 'player', role: 'tank', maxHealth: 1000, pos: { x: 5, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  threat.add('boss', 'p1', 1);
  attachBoss(sim, new WindowAI(mode), 'boss', 10);
  sim.run();
  return sim;
}

const windows = (sim: Simulation) =>
  sim.trace
    .list()
    .filter((e) => e.kind === 'timer_window')
    .map((e) => [e.t, e.data.ability, e.data.earliestMs, e.data.latestMs]);

describe('published timer windows follow the EventMap (A-034)', () => {
  it('a delay raises both bounds to the floor, and the event fires inside its window', () => {
    const sim = run('ok');
    expect(windows(sim)).toEqual([
      [0, 'a', 10000, 10000],
      [0, 'b', 12000, 15000],
      // A at 10 s delays B to at least 18 s: both bounds were below it.
      [10000, 'b', 18000, 18000],
      // The same event under a new name: the old name is cleared first.
      [10000, 'a', null, null],
      [10000, 'a_again', 20000, 20000],
    ]);
    const b = sim.trace.list().find((e) => e.kind === 'ai_event' && e.data.event === 'b');
    expect(b?.t).toBe(18000);
    expect(sim.timerWindows.get('boss|b')).toEqual({ boss: 'boss', ability: 'b', earliestMs: 18000, latestMs: 18000 });
  });

  it('a window that does not contain its event throws', () => {
    expect(() => run('wrong_window')).toThrow(/timer window b \[20000, 30000\] does not contain event 2 \(due in 1\d{4} ms\)/);
  });

  it('a window whose event is gone is cleared', () => {
    const sim = run('cancel_b');
    expect(windows(sim)).toContainEqual([10000, 'b', null, null]);
    expect(sim.timerWindows.has('boss|b')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/timer-windows.test.ts`
Expected: FAIL (`m.timeUntilEvent is not a function`; `this.publishWindow is not a function`); the type check would also reject the file.

- [ ] **Step 3: Implement**

In `packages/engine/src/eventmap.ts`, after

```ts
  cancelGroup(group: number): void {
    if (group === 0) return;
    const m = bit(group);
    this.entries = this.entries.filter((e) => (e.groupMask & m) === 0);
  }
```

add

```ts

  /**
   * GetTimeUntilEvent (EventMap.cpp 200–207): milliseconds until the earliest scheduled event with this id, or null when
   * none is scheduled (AzerothCore returns Milliseconds::max()). An event that is due but not yet executed gives 0 or less.
   */
  timeUntilEvent(id: number): number | null {
    // Entries are kept sorted by time, so the first match is the earliest.
    const e = this.entries.find((x) => x.id === id);
    return e ? e.at - this.time : null;
  }

  /** HasTimeUntilEvent (EventMap.cpp 209–212). */
  hasTimeUntilEvent(id: number): boolean {
    return this.timeUntilEvent(id) !== null;
  }
```

In `packages/engine/src/boss.ts` replace

```ts
  protected events!: EventMap;

  onEngage(ctx: BossContext, who: Unit | null = null): void {
    this.events = new EventMap(ctx.sim.rng.stream(`boss:${this.bossId}.timers`));
    this.engage(ctx, who);
  }
```

with

```ts
  protected events!: EventMap;
  /** Published timer windows by event id, in EventMap time (A-034). */
  private readonly windows = new Map<number, { ability: string; earliest: number; latest: number }>();

  onEngage(ctx: BossContext, who: Unit | null = null): void {
    this.events = new EventMap(ctx.sim.rng.stream(`boss:${this.bossId}.timers`));
    this.windows.clear();
    this.engage(ctx, who);
  }

  /**
   * Publishes the boss-mod window of a scheduled event: it is due between minMs and maxMs from now. The window is checked
   * against the EventMap (GetTimeUntilEvent), so a window that does not contain its event fails loudly instead of going
   * stale. A window published earlier for the same event under another ability name is cleared. Nothing happens once the
   * fight is over.
   */
  protected publishWindow(ctx: BossContext, ability: string, eventId: number, minMs: number, maxMs: number, causes: readonly string[]): void {
    if (ctx.sim.over) return;
    const until = this.events.timeUntilEvent(eventId);
    if (until === null || until < minMs || until > maxMs) {
      throw new Error(`timer window ${ability} [${minMs}, ${maxMs}] does not contain event ${eventId} (${until === null ? 'not scheduled' : `due in ${until} ms`})`);
    }
    const old = this.windows.get(eventId);
    if (old && old.ability !== ability) ctx.clearTimer(old.ability, causes);
    this.windows.set(eventId, { ability, earliest: this.events.now + minMs, latest: this.events.now + maxMs });
    ctx.publishTimer(ability, minMs, maxMs, causes);
  }

  /**
   * After the script delayed events (DelayEventsToMax): the event is now due no earlier than floorMs from now, so both
   * bounds of its window move up to that floor, which is all a boss mod could know. A window whose event is no longer
   * scheduled is cleared; an unchanged window is not published again.
   */
  protected raiseWindow(ctx: BossContext, eventId: number, floorMs: number, causes: readonly string[]): void {
    if (ctx.sim.over) return;
    const w = this.windows.get(eventId);
    if (!w) return;
    if (!this.events.hasTimeUntilEvent(eventId)) {
      this.windows.delete(eventId);
      ctx.clearTimer(w.ability, causes);
      return;
    }
    const now = this.events.now;
    const earliest = Math.max(w.earliest, now + floorMs);
    const latest = Math.max(w.latest, now + floorMs);
    if (earliest === w.earliest && latest === w.latest) return;
    this.publishWindow(ctx, w.ability, eventId, earliest - now, latest - now, causes);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/timer-windows.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Documents.** Append to the table in `docs/adaptations.md`:

```markdown
| A-034 | Timer windows follow the EventMap. `EventMap.timeUntilEvent(id)` is AzerothCore's GetTimeUntilEvent (EventMap.cpp 200–207; null instead of `Milliseconds::max()`), `hasTimeUntilEvent` its HasTimeUntilEvent (209–212). `EventScriptedAI.publishWindow` publishes a window for a scheduled event and throws when the event is not due inside it; `raiseWindow` is called after a delay (DelayEventsToMax) with the delay as floor: both bounds move up to now + floor, the window of an event that is no longer scheduled is cleared, an unchanged window is not published again. The published bounds come only from what the script announced and from the delay, never from the hidden scheduled time (spec §8.6). Windows are kept in EventMap time, which stands still while the boss has no victim; the published times then lag by that pause. The helpers do nothing once the fight is over. | Boss-mod timers are player knowledge and not part of AzerothCore; a wrong window would mislead actors and readers. | `timer-windows.test.ts` |
```

In `docs/superpowers/plans/2026-11-10-contract-changes-for-plans-2-3.md` replace `Add an EventMap query like
   `GetTimeUntilEvent` and derive published windows from it.  (partly: `clearTimer`)` with `Add an EventMap query like
   `GetTimeUntilEvent` and derive published windows from it.  (done in Plan 2b-2: `timeUntilEvent`, `publishWindow`, `raiseWindow`, A-034)`, and replace `(still open: Plan 2b-2; the engine has no time-until query yet)` with `(done in Plan 2b-2, A-034)`.

- [ ] **Step 6: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs
git commit -m "feat(engine): EventMap time-until query; timer windows checked against the EventMap

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 2: Generic role actors are stand-ins (`PolicyFactory.approximate`, adds A-035)

A policy factory that is not a supported spec must be reported like a rate stand-in (spec §6.3, §6.4). Today only `kind: standin` members are `approximate`.

**Files:**
- Create: `packages/engine/test/approximate-actors.test.ts`
- Modify: `packages/engine/src/run.ts`, `docs/adaptations.md`

**Changed behaviour:** none for existing content (`training_caster` and the test caster do not set the flag, so their traces are unchanged).

- [ ] **Step 1: Write the failing test** `packages/engine/test/approximate-actors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePlan, parseScenario, prepareRun } from '../src/plan/prepare';
import { runScenario, type ContentRegistry, type PolicyFactory } from '../src/run';
import { dummyBoss } from './fixtures/dummy-boss';
import { PLAN_YAML, SCENARIO_YAML } from './fixtures/dummy-plan';
import { testCaster } from './fixtures/test-caster';

function run(caster: PolicyFactory) {
  const registry: ContentRegistry = { bosses: new Map([['dummy', dummyBoss]]), policies: new Map([['test_caster', caster]]), actions: new Map(), checks: new Map() };
  const plan = parsePlan('dummy-plan.yaml', PLAN_YAML);
  const scenario = parseScenario('dummy-scenario.yaml', SCENARIO_YAML);
  if (!plan.ok || !scenario.ok) throw new Error('fixtures must parse');
  const prepared = prepareRun({ plan: plan.value, planFile: 'dummy-plan.yaml', scenario: scenario.value, scenarioFile: 'dummy-scenario.yaml' });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.problems));
  const r = runScenario(prepared.value, registry);
  if (r.outcome === 'invalid') throw new Error(JSON.stringify(r.problems));
  return r;
}

describe('generic role actors are stand-ins (spec §6.3, A-035)', () => {
  it('a spec is not approximate by default', () => {
    const r = run(testCaster);
    expect(r.summary.limitations.standIns).toEqual(['h1', 'p3', 't1']);
    expect(r.trace.meta.units.find((u) => u.id === 'p1')?.approximate).toBe(false);
  });

  it('units of an approximate policy factory are marked and reported like rate stand-ins', () => {
    const r = run({ ...testCaster, approximate: true });
    expect(r.summary.limitations.standIns).toEqual(['h1', 'p1', 'p2', 'p3', 't1']);
    expect(r.trace.meta.units.filter((u) => u.kind === 'player').every((u) => u.approximate)).toBe(true);
    // They still act through the cast machinery.
    expect(r.trace.events.some((e) => e.kind === 'cast_success' && e.data.caster === 'p1' && e.data.spell === 'test_bolt')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/engine/test/approximate-actors.test.ts`
Expected: FAIL in the second test (`standIns` is `['h1', 'p3', 't1']`); the type check rejects `approximate`.

- [ ] **Step 3: Implement**

In `packages/engine/src/run.ts` replace

```ts
  readonly role: Exclude<Role, 'boss' | 'add'>;
  create(args: {
```

with

```ts
  readonly role: Exclude<Role, 'boss' | 'add'>;
  /**
   * True for a generic role actor that is not a supported spec (spec §6.3): it uses the cast machinery, but its abilities
   * and numbers are invented. Its units are marked `approximate` and listed as stand-ins in the limitation report (A-035).
   */
  readonly approximate?: boolean;
  create(args: {
```

In `packages/engine/src/run.ts` replace

```ts
      sim.addUnit({ ...made.unit, id: m.id, name: m.name, kind: 'player', role: factory.role, pos });
```

with

```ts
      sim.addUnit({ ...made.unit, id: m.id, name: m.name, kind: 'player', role: factory.role, approximate: factory.approximate === true, pos });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/engine/test/approximate-actors.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Append to the table in `docs/adaptations.md`:**

```markdown
| A-035 | Generic role actors. A policy factory with `approximate: true` is an ability-using stand-in: it acts through the cast machinery (cast time, global cooldown, range, interruption by movement, decision wake-ups), but it is not a supported spec; its units are marked `approximate` in trace and summary and listed with the rate stand-ins in the limitation report, and its numbers are `assumption` entries. The content has two: `generic_caster` (one 2 s damage spell at the boss) and `generic_healer` (one 1.5 s heal on the living player in range with the lowest health percentage, counting heals other units are already casting on that player; a tank below 85 % comes first; a player missing less than 6,000 health is skipped; ties go to the lowest id; a smaller heal lands on up to five random players within 10 yd of the target and stands in for area and periodic heals). Neither has resources, haste, crits or cooldowns; neither can act while moving. | The engine has no class specs before Plan 3; the owner wants players who use abilities rather than rates wherever the engine allows it. | `approximate-actors.test.ts`, `generic-actors.test.ts` |
```

- [ ] **Step 6: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/engine docs/adaptations.md
git commit -m "feat(engine): generic role actors are marked approximate and reported as stand-ins

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 3: The generic caster and the generic healer

Two policy factories in `@raid/content` (design decision 10, A-035). Their values are assumptions chosen so that a 25-player raid of them can heal through the fight and kill Festergut in about four minutes; they are not class data.

**Files:**
- Create: `packages/content/src/generic/caster.ts`, `packages/content/src/generic/healer.ts`, `packages/content/test/generic-actors.test.ts`
- Modify: `packages/content/src/index.ts`

**Changed behaviour:** none (new specs; nothing uses them yet).

- [ ] **Step 1: Write the failing test** `packages/content/test/generic-actors.test.ts`:

```ts
import { parsePlan, parseScenario, prepareRun, runScenario, type ActorView, type UnitView } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { chooseHealTarget } from '../src/generic/healer';
import { CONTENT, CONTENT_TEXT_EN } from '../src/index';

const PLAN = `
id: generic-actors
boss: training_dummy
roster:
  - { id: t1, name: Tanky, kind: standin, role: tank, maxHealth: 40000, ratePerSecond: 600, armor: 25000, threatMultiplier: 30, reaction: { minMs: 300, maxMs: 300 } }
  - { id: h1, name: Healy, kind: modelled, spec: generic_healer, profile: default, reaction: { minMs: 300, maxMs: 300 } }
  - { id: c1, name: Casty, kind: modelled, spec: generic_caster, profile: default, reaction: { minMs: 300, maxMs: 300 } }
spots:
  tank: { x: 6, y: 0 }
  heal: { x: -20, y: 0 }
  ranged: { x: 20, y: 0 }
  out: { x: 44, y: 0 }
phases:
  - phase: default
    assignments: { t1: tank, h1: heal, c1: ranged }
rules:
  - id: run-when-marked
    who: [c1]
    when: { on: aura_applied, aura: mark, target: self }
    do: { do: move_to, spot: out }
    priority: 60
`;
const SCENARIO = `
id: generic-actors
plan: plan.yaml
difficulty: 25n
seed: 5
maxDurationMs: 30000
observation:
  text: scenario.training_dummy_clean.observation
  checks:
    - { check: outcome_is, outcome: kill }
`;

function run() {
  const plan = parsePlan('plan.yaml', PLAN);
  const scenario = parseScenario('scenario.yaml', SCENARIO);
  if (!plan.ok || !scenario.ok) throw new Error(JSON.stringify([plan, scenario]));
  const prepared = prepareRun({ plan: plan.value, planFile: 'plan.yaml', scenario: scenario.value, scenarioFile: 'scenario.yaml' });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.problems));
  const r = runScenario(prepared.value, CONTENT);
  if (r.outcome === 'invalid') throw new Error(JSON.stringify(r.problems));
  return r;
}

describe('generic role actors (A-035)', () => {
  const r = run();
  const of = (kind: string, where: Record<string, unknown>) => r.trace.events.filter((e) => e.kind === kind && Object.entries(where).every(([k, v]) => e.data[k] === v));

  it('the caster casts its 2 s bolt at the boss, and movement interrupts it', () => {
    const casts = of('cast_start', { caster: 'c1', spell: 'caster_bolt' });
    expect(casts[0]).toMatchObject({ t: 0, data: { target: 'training_dummy', castTimeMs: 2000 } });
    const hits = of('damage', { source: 'c1', ability: 'caster_bolt' });
    expect(hits[0].t).toBe(2000);
    // The last hit can be cut short by the dummy's remaining health: amount + overkill is the full hit.
    const full = (e: (typeof hits)[number]): number => Number(e.data.amount) + Number(e.data.overkill);
    expect(hits.every((e) => full(e) >= 22000 && full(e) <= 26000 && e.data.school === 'fire')).toBe(true);
    // The dummy marks at 12 s; the caster runs out, which interrupts the cast it had started at 12 s.
    expect(of('cast_interrupted', { unit: 'c1', spell: 'caster_bolt' }).map((e) => e.data.reason)).toEqual(['moved']);
  });

  it('the healer heals the tank once it misses enough health, never the boss', () => {
    const heals = of('heal', { source: 'h1', ability: 'healer_heal' });
    expect(heals.length).toBeGreaterThan(0);
    expect(heals.every((e) => e.data.target !== 'training_dummy')).toBe(true);
    expect(heals.some((e) => e.data.target === 't1' && Number(e.data.amount) + Number(e.data.overheal) >= 12000)).toBe(true);
    const first = of('cast_start', { caster: 'h1', spell: 'healer_heal' })[0];
    expect(first.data).toMatchObject({ target: 't1', castTimeMs: 1500 });
  });

  it('both are stand-ins in the limitation report, and their numbers are assumptions', () => {
    expect(r.summary.limitations.standIns).toEqual(['c1', 'h1', 't1']);
    const keys = r.summary.limitations.assumptions.map((a) => a.key);
    for (const key of ['generic_caster.bolt_min', 'generic_caster.health', 'generic_healer.heal_min', 'generic_healer.splash_targets', 'generic_healer.tank_first_below_pct']) {
      expect(keys, key).toContain(key);
    }
    expect(CONTENT_TEXT_EN['ability.caster_bolt']).toBe('Bolt');
    expect(CONTENT_TEXT_EN['ability.healer_heal']).toBe('Heal');
  });
});

describe('chooseHealTarget', () => {
  const unit = (id: string, role: UnitView['role'], health: number, maxHealth: number, cast: UnitView['cast'] = null): UnitView => ({
    id,
    name: id,
    kind: role === 'boss' ? 'creature' : 'player',
    role,
    health,
    maxHealth,
    alive: health > 0,
    x: 0,
    y: 0,
    moving: false,
    combatReach: 1.5,
    auras: [],
    cast,
  });
  const view = (units: UnitView[], outOfRange: string[] = []): ActorView =>
    ({
      now: 0,
      self: units.find((u) => u.id === 'h1')!,
      units,
      canCast: (_spell: string, target: string) => (outOfRange.includes(target) ? { ok: false, reason: 'out_of_range' } : { ok: true }),
    }) as unknown as ActorView;
  const h1 = unit('h1', 'healer', 30000, 30000);
  const choose = (units: UnitView[], outOfRange: string[] = []) => chooseHealTarget(view([h1, ...units], outOfRange), 13000, 6000, 85);

  it('takes the lowest health percentage, ties to the lowest id, and skips small deficits and the dead', () => {
    expect(choose([unit('a', 'ranged', 20000, 30000), unit('b', 'ranged', 15000, 30000)])).toBe('b');
    expect(choose([unit('b', 'ranged', 15000, 30000), unit('a', 'ranged', 15000, 30000)].sort((x, y) => (x.id < y.id ? -1 : 1)))).toBe('a');
    expect(choose([unit('a', 'ranged', 25000, 30000)])).toBeNull();
    expect(choose([unit('a', 'ranged', 0, 30000), unit('boss', 'boss', 10, 1000000)])).toBeNull();
  });

  it('counts the heals other healers are casting', () => {
    const h2 = unit('h2', 'healer', 30000, 30000, { spell: 'healer_heal', target: 'a', endsAtMs: 1000 });
    // a: 12,000 + 13,000 incoming = 25,000 of 30,000, a deficit below 6,000: b is next.
    expect(choose([h2, unit('a', 'ranged', 12000, 30000), unit('b', 'ranged', 20000, 30000)])).toBe('b');
  });

  it('a tank below 85 % comes first; a target out of range is skipped', () => {
    const units = [unit('a', 'ranged', 9000, 30000), unit('t1', 'tank', 60000, 80000)];
    expect(choose(units)).toBe('t1');
    expect(choose(units, ['t1'])).toBe('a');
    expect(choose([unit('a', 'ranged', 9000, 30000), unit('t1', 'tank', 70000, 80000)])).toBe('a');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/content/test/generic-actors.test.ts`
Expected: FAIL, cannot resolve `../src/generic/healer`.

- [ ] **Step 3: Write `packages/content/src/generic/caster.ts`:**

```ts
import type { PolicyFactory } from '@raid/engine';

const assumed = (key: string, value: number, what: string): Record<string, unknown> => ({
  key: `generic_caster.${key}`,
  value,
  source: {
    kind: 'assumption',
    rationale: `${what}; the generic caster is an ability-using stand-in, not a spec (A-035)`,
    confirmBy: 'replaced by the Fire Mage model with client spell data (Plan 3)',
  },
});

/**
 * A generic ranged damage dealer: it casts one cast-time spell at the boss whenever it can, so it stops while it moves and
 * loses a cast that movement interrupts. An ability-using stand-in (A-035): its numbers are assumptions, it has no
 * resources, haste, crits or cooldowns.
 */
export const genericCaster: PolicyFactory = {
  spec: 'generic_caster',
  role: 'ranged',
  approximate: true,
  data: [
    assumed('health', 34000, 'health of a ranged damage dealer in a 25-player normal raid'),
    assumed('bolt_min', 22000, 'lowest hit of the one damage spell'),
    assumed('bolt_max', 26000, 'highest hit of the one damage spell'),
    assumed('bolt_cast_ms', 2000, 'cast time of the one damage spell'),
    assumed('bolt_gcd_ms', 1500, 'global cooldown'),
    assumed('bolt_range_yd', 40, 'range of the one damage spell'),
  ],
  create({ sim, data }) {
    const n = (key: string): number => data.num(`generic_caster.${key}`);
    if (!sim.catalog.hasSpell('caster_bolt')) {
      sim.catalog.addSpell({
        id: 'caster_bolt',
        castTimeMs: n('bolt_cast_ms'),
        gcdMs: n('bolt_gcd_ms'),
        cooldownMs: 0,
        rangeYd: n('bolt_range_yd'),
        usableWhileMoving: false,
        target: 'unit',
        effects: [{ type: 'damage', school: 'fire', min: n('bolt_min'), max: n('bolt_max') }],
      });
    }
    return {
      unit: {
        maxHealth: n('health'),
        speedYdPerSec: data.num('core.player_run_speed_yd_s'),
        combatReach: data.num('core.player_combat_reach_yd'),
        boundingRadius: data.num('core.player_bounding_radius_yd'),
      },
      policy: {
        wakeOn: { anyHealthChange: false, anyAuraChange: false },
        decide(view) {
          const boss = view.units.find((u) => u.role === 'boss' && u.alive);
          if (!boss || !view.canCast('caster_bolt', boss.id).ok) return { type: 'none' };
          return { type: 'cast', spell: 'caster_bolt', target: boss.id };
        },
      },
    };
  },
};
```

- [ ] **Step 4: Write `packages/content/src/generic/healer.ts`:**

```ts
import type { ActorView, PolicyAction, PolicyFactory } from '@raid/engine';

const assumed = (key: string, value: number, what: string): Record<string, unknown> => ({
  key: `generic_healer.${key}`,
  value,
  source: {
    kind: 'assumption',
    rationale: `${what}; the generic healer is an ability-using stand-in, not a spec (A-035)`,
    confirmBy: 'replaced by the Restoration Druid model with client spell data (Plan 3)',
  },
});

/**
 * The healer's choice (spec §8.6: only what a player sees). Health is counted with the heals other units are already
 * casting on a player (their cast bars; raid frames show incoming heals the same way). A tank below tankFirstBelowPct
 * percent of its health comes first; otherwise the living player in range with the lowest health percentage. A player
 * who misses less than minDeficit is skipped. Ties go to the lowest id.
 */
export function chooseHealTarget(view: ActorView, healAmount: number, minDeficit: number, tankFirstBelowPct: number): string | null {
  const incoming = new Map<string, number>();
  for (const u of view.units) {
    if (u.id !== view.self.id && u.alive && u.cast?.spell === 'healer_heal') incoming.set(u.cast.target, (incoming.get(u.cast.target) ?? 0) + healAmount);
  }
  let best: string | null = null;
  let bestRatio = Number.POSITIVE_INFINITY;
  let bestIsUrgentTank = false;
  for (const u of view.units) {
    if (u.kind !== 'player' || !u.alive) continue;
    const expected = u.health + (incoming.get(u.id) ?? 0);
    if (u.maxHealth - expected < minDeficit) continue;
    const ratio = expected / u.maxHealth;
    const urgentTank = u.role === 'tank' && ratio * 100 < tankFirstBelowPct;
    const better = urgentTank !== bestIsUrgentTank ? urgentTank : ratio < bestRatio;
    if (!better || !view.canCast('healer_heal', u.id).ok) continue;
    best = u.id;
    bestRatio = ratio;
    bestIsUrgentTank = urgentTank;
  }
  return best;
}

/**
 * A generic healer: one cast-time heal on the player who needs it most (see chooseHealTarget), with a smaller heal on a
 * few players near that target, which stands in for the area and periodic heals of real healers. An ability-using
 * stand-in (A-035): its numbers are assumptions, it has no mana, haste, crits or cooldowns, and it cannot heal while moving.
 */
export const genericHealer: PolicyFactory = {
  spec: 'generic_healer',
  role: 'healer',
  approximate: true,
  data: [
    assumed('health', 34000, 'health of a healer in a 25-player normal raid'),
    assumed('heal_min', 12000, 'lowest amount of the one heal'),
    assumed('heal_max', 14000, 'highest amount of the one heal'),
    assumed('heal_cast_ms', 1500, 'cast time of the one heal'),
    assumed('heal_gcd_ms', 1500, 'global cooldown'),
    assumed('heal_range_yd', 40, 'range of the one heal'),
    assumed('splash_min', 6500, 'lowest amount of the heal on players near the target'),
    assumed('splash_max', 7500, 'highest amount of the heal on players near the target'),
    assumed('splash_radius_yd', 10, 'players this close to the target can receive the smaller heal'),
    assumed('splash_targets', 5, 'how many players near the target receive the smaller heal'),
    assumed('heal_min_deficit', 6000, 'a player missing less health than this is not healed yet'),
    assumed('tank_first_below_pct', 85, 'a tank below this health percentage is healed before anyone else'),
  ],
  create({ sim, data }) {
    const n = (key: string): number => data.num(`generic_healer.${key}`);
    if (!sim.catalog.hasSpell('healer_heal')) {
      sim.catalog.addSpell({
        id: 'healer_heal',
        castTimeMs: n('heal_cast_ms'),
        gcdMs: n('heal_gcd_ms'),
        cooldownMs: 0,
        rangeYd: n('heal_range_yd'),
        usableWhileMoving: false,
        target: 'unit',
        effects: [
          { type: 'heal', min: n('heal_min'), max: n('heal_max') },
          // Stands in for the area and periodic heals of real healers: a smaller heal on a few players near the target.
          {
            type: 'area',
            radius: n('splash_radius_yd'),
            center: 'target',
            relation: 'ally',
            playersOnly: true,
            maxTargets: n('splash_targets'),
            effects: [{ type: 'heal', min: n('splash_min'), max: n('splash_max') }],
          },
        ],
      });
    }
    const healAmount = (n('heal_min') + n('heal_max')) / 2;
    const minDeficit = n('heal_min_deficit');
    const tankFirstBelowPct = n('tank_first_below_pct');
    return {
      unit: {
        maxHealth: n('health'),
        speedYdPerSec: data.num('core.player_run_speed_yd_s'),
        combatReach: data.num('core.player_combat_reach_yd'),
        boundingRadius: data.num('core.player_bounding_radius_yd'),
      },
      policy: {
        wakeOn: { anyHealthChange: true, anyAuraChange: false },
        decide(view): PolicyAction {
          // Nothing can be cast while moving or during the global cooldown; the controller wakes the actor afterwards.
          if (view.self.moving || view.gcdReadyAtMs > view.now) return { type: 'none' };
          const target = chooseHealTarget(view, healAmount, minDeficit, tankFirstBelowPct);
          return target === null ? { type: 'none' } : { type: 'cast', spell: 'healer_heal', target };
        },
      },
    };
  },
};
```

- [ ] **Step 5: Register them and their names.**

In `packages/content/src/index.ts` replace

```ts
import { trainingDummy } from './training-dummy/boss';
import { trainingCaster } from './training-dummy/caster';
```

with

```ts
import { genericCaster } from './generic/caster';
import { genericHealer } from './generic/healer';
import { trainingDummy } from './training-dummy/boss';
import { trainingCaster } from './training-dummy/caster';
```

In `packages/content/src/index.ts` replace

```ts
  policies: new Map([[trainingCaster.spec, trainingCaster]]),
```

with

```ts
  policies: new Map([
    [genericCaster.spec, genericCaster],
    [genericHealer.spec, genericHealer],
    [trainingCaster.spec, trainingCaster],
  ]),
```

In `packages/content/src/index.ts`, after

```ts
  'ability.standin_heal': 'heal',
```

add

```ts
  'ability.caster_bolt': 'Bolt',
  'ability.healer_heal': 'Heal',
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test packages/content/test/generic-actors.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/content
git commit -m "feat(content): generic caster and healer, ability-using stand-ins

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 4: Festergut's data: spell ids, database values, script timers

Everything the module reads later, with its source (spec §7, design decisions 1, 2, 7, 9). The worked examples in the test are calculated by hand from the rows quoted under "Sources read for this plan".

**Files:**
- Create: `packages/content/src/festergut/spell-ids.ts`, `packages/content/src/festergut/data.ts`, `packages/content/test/festergut/data.test.ts`
- Modify: `tsconfig.json`, `packages/engine/src/index.ts`

**Changed behaviour:** none. `@raid/engine` now also exports `melee.ts` (`creatureMeleeDamage`, `armorReduction`, …) and `modifiers.ts` (`damageDoneFactor`, …), which were missing from its index.

- [ ] **Step 1: Write the failing test** `packages/content/test/festergut/data.test.ts`:

```ts
import { DataRegistry, PINS } from '@raid/data';
import { CORE_DATA } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { FESTERGUT_DATA_25N, festergutData } from '../../src/festergut/data';
import { FestergutSpells } from '../../src/festergut/spell-ids';

const data = new DataRegistry([...CORE_DATA, ...FESTERGUT_DATA_25N]);
const source = (key: string) => data.baselineOf(key).source;

describe('Festergut data, 25-player normal', () => {
  it('worked example: health and armor from the class level stats and the template modifiers', () => {
    // basehp2 13945 × HealthModifier 2900 = 40,440,500; basearmor 10643 × ArmorModifier 1 = 10,643.
    expect(data.num('festergut.health')).toBe(40440500);
    expect(data.num('festergut.armor')).toBe(10643);
    expect(data.num('festergut.level')).toBe(83);
  });

  it('worked example: melee damage before armor', () => {
    // Attack power part: 805 / 14 × 1 = 57.5. Multiplier: DamageModifier 122.6 × attack time 2000 / 1000 = 245.2.
    // min = (177.074 + 57.5) × 245.2 = 57,517.54 → 57,517; max = (1.5 × 177.074 + 57.5) × 245.2 = 79,226.82 → 79,226.
    expect(data.num('festergut.melee_min')).toBe(57517);
    expect(data.num('festergut.melee_max')).toBe(79226);
  });

  it('the attack time is the core default because the database stores 0', () => {
    expect(data.num('festergut.base_attack_time_db')).toBe(0);
    expect(data.num('festergut.attack_time_ms')).toBe(2000);
    expect(source('festergut.default_attack_time_ms')).toEqual({ kind: 'code', file: 'src/server/game/Entities/Unit/Unit.h', commit: PINS.azerothcoreCommit, line: 43 });
  });

  it('worked example: the first gas comes when Putricide has run 101.82 yd at 15 yd/s', () => {
    // dx = 4356.19 − 4324.82 = 31.37, dy = 3262.90 − 3166.03 = 96.87, dz = 389.482 − 389.3831 = 0.0989.
    // sqrt(31.37² + 96.87² + 0.0989²) = 101.8228 yd; / 15 yd/s = 6.78819 s → 6788 ms.
    expect(data.num('festergut.first_gas_delay_ms')).toBe(6788);
    expect(source('festergut.first_gas_delay_ms').kind).toBe('derived');
  });

  it('database values name their table, row, column and SQL line; script values their line', () => {
    expect(source('festergut.health_modifier')).toEqual({
      kind: 'db',
      table: 'creature_template',
      key: 'entry 37504, column HealthModifier (data/sql/base/db_world/creature_template.sql line 28891)',
      commit: PINS.azerothcoreCommit,
    });
    expect(source('festergut.combat_reach_yd')).toMatchObject({ kind: 'db', table: 'creature_model_info' });
    expect(data.num('festergut.combat_reach_yd')).toBe(8);
    expect(source('festergut.inhale_repeat_ms')).toEqual({
      kind: 'code',
      file: 'src/server/scripts/Northrend/IcecrownCitadel/boss_festergut.cpp',
      commit: PINS.azerothcoreCommit,
      line: 215,
    });
    expect(data.num('festergut.gas_spore_targets')).toBe(3);
    expect(data.num('festergut.vile_gas_min_far_targets')).toBe(8);
  });

  it('holds every spell field of the 25n variants with a spelldata source', () => {
    const spells = new FestergutSpells('25n');
    expect(spells.variantIds()).toEqual([47008, 69157, 69162, 69164, 69165, 69279, 70135, 70138, 70468, 71218, 71219, 71221, 71222, 71288, 71912, 72101, 72228, 72551]);
    expect(data.num(spells.key('pungent_blight', 'e0.min'))).toBe(48750);
    expect(data.num(spells.key('pungent_blight', 'e0.max'))).toBe(51250);
    expect(source(spells.key('pungent_blight', 'e0.base_points'))).toMatchObject({ kind: 'spelldata', spellId: 71219, field: 'EffectBasePoints[0]' });
  });

  it('no value is an assumption, and only 25n exists', () => {
    expect(FESTERGUT_DATA_25N.filter((e) => e.source.kind === 'assumption')).toEqual([]);
    expect(() => festergutData('10n')).toThrow(/25n only/);
  });
});

describe('Festergut spell ids', () => {
  const spells = new FestergutSpells('25n');

  it('resolves base ids to the 25n variant and any id to its engine id', () => {
    expect(spells.variant('inhaled_blight')).toBe(71912);
    expect(spells.variant('inhale_blight')).toBe(69165);
    expect(spells.variant('gas_spore')).toBe(71221);
    expect(spells.id(69166)).toBe('inhaled_blight');
    expect(spells.id(71912)).toBe('inhaled_blight');
    expect(spells.id(69291)).toBe('inoculated');
    expect(spells.id(72103)).toBe('inoculated');
    expect(spells.id(70135)).toBe('gaseous_blight_large_damage');
    expect(() => spells.id(1)).toThrow(/not part of the Festergut fight/);
  });

  it('heroic slots that are empty fall back two modes', () => {
    expect(new FestergutSpells('25h').variant('gas_spore')).toBe(71221);
    expect(new FestergutSpells('10h').variant('pungent_blight')).toBe(73031);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/content/test/festergut/data.test.ts`
Expected: FAIL, cannot resolve `../../src/festergut/data`.

- [ ] **Step 3: Let the content import the spell data file and the engine's melee formula.**

In `tsconfig.json` replace

```json
    "strict": true,
```

with

```json
    "strict": true,
    "resolveJsonModule": true,
```

In `packages/engine/src/index.ts` replace

```ts
export * from './limitations';
export * from './movement';
```

with

```ts
export * from './limitations';
export * from './melee';
export * from './modifiers';
export * from './movement';
```

- [ ] **Step 4: Write `packages/content/src/festergut/spell-ids.ts`:**

```ts
import type { DataRegistry, Difficulty } from '@raid/data';
import rawSpellData from '../../data/spelldata/festergut.json';
import { spellKey } from '../spelldata/entries';
import { parseSpellDataFile, type SpellDataFile } from '../spelldata/file';
import { SpellVariants } from '../spelldata/variants';

/** The client spell extraction for this fight (docs/sources.md, "Spell data"). */
export const FESTERGUT_SPELL_FILE: SpellDataFile = parseSpellDataFile(rawSpellData);

/**
 * Engine id → base spell id as the AzerothCore scripts name it (boss_festergut.cpp 48–54 and 63, icecrown_citadel.h 48;
 * the others are reached through trigger fields of the spell data). The engine id does not depend on the difficulty.
 */
export const FESTERGUT_BASE_IDS = {
  inhale_blight: 69165,
  inhaled_blight: 69166,
  pungent_blight: 69195,
  gaseous_blight_large: 69157,
  gaseous_blight_medium: 69162,
  gaseous_blight_small: 69164,
  gaseous_blight_large_damage: 69159,
  gaseous_blight_medium_damage: 69161,
  gaseous_blight_small_damage: 69163,
  gas_spore: 69278,
  gas_spore_carrier: 69279,
  blighted_spores: 69290,
  inoculated: 69291,
  vile_gas: 69240,
  vile_gas_splash: 69244,
  gastric_bloat: 72219,
  gastric_explosion: 72227,
  berserk: 47008,
} as const;

export type FestergutSpellName = keyof typeof FESTERGUT_BASE_IDS;

const DIFFICULTIES: readonly Difficulty[] = ['10n', '25n', '10h', '25h'];
const NAMES = Object.keys(FESTERGUT_BASE_IDS) as FestergutSpellName[];

/**
 * The fight's spells for one difficulty: resolves base ids to their difficulty variant like GetSpellIdForDifficulty
 * (SpellMgr.cpp 538–578), and maps any numeric id of a spell (base or variant) to its engine id. Spell and aura scripts
 * get this object, so their lookups work like the script's `sSpellMgr->GetSpellIdForDifficulty(...)` calls.
 */
export class FestergutSpells {
  private readonly variants = new SpellVariants(FESTERGUT_SPELL_FILE);
  private readonly names = new Map<number, FestergutSpellName>();

  constructor(readonly difficulty: Difficulty) {
    for (const name of NAMES) {
      const base = FESTERGUT_BASE_IDS[name];
      for (const id of [base, ...DIFFICULTIES.map((d) => this.variants.variantFor(base, d))]) {
        const known = this.names.get(id);
        if (known && known !== name) throw new Error(`spell ${id} belongs to ${known} and ${name}`);
        this.names.set(id, name);
      }
    }
  }

  /** The numeric spell id used in this difficulty. */
  variant(name: FestergutSpellName): number {
    return this.variants.variantFor(FESTERGUT_BASE_IDS[name], this.difficulty);
  }

  /** Every numeric id used in this difficulty, sorted. */
  variantIds(): number[] {
    return NAMES.map((n) => this.variant(n)).sort((a, b) => a - b);
  }

  /** The engine id of a numeric spell id (base or any difficulty variant). */
  id(spellId: number): FestergutSpellName {
    const name = this.names.get(spellId);
    if (!name) throw new Error(`spell ${spellId} is not part of the Festergut fight`);
    return name;
  }

  /** Data key of a field of the spell's variant in this difficulty. */
  key(name: FestergutSpellName, field: string): string {
    return spellKey(this.variant(name), field);
  }

  /** Reads a numeric spell field through the registry, so the access is recorded with its source. */
  num(data: DataRegistry, name: FestergutSpellName, field: string): number {
    return data.num(this.key(name, field));
  }
}
```

- [ ] **Step 5: Write `packages/content/src/festergut/data.ts`:**

```ts
import { PINS, type DataEntry, type Difficulty } from '@raid/data';
import { creatureMeleeDamage } from '@raid/engine';
import { spellDataEntries } from '../spelldata/entries';
import { FESTERGUT_SPELL_FILE, FestergutSpells } from './spell-ids';

const commit = PINS.azerothcoreCommit;
const SQL = 'data/sql/base/db_world';
const FG = 'src/server/scripts/Northrend/IcecrownCitadel/boss_festergut.cpp';
const PP = 'src/server/scripts/Northrend/IcecrownCitadel/boss_professor_putricide.cpp';

/** A value read from the world database SQL of the pinned commit; the key names the row, the column and the SQL line. */
const db = (key: string, value: number, table: string, row: string, column: string, line: number): DataEntry => ({
  key,
  value,
  source: { kind: 'db', table, key: `${row}, column ${column} (${SQL}/${table}.sql line ${line})`, commit },
});

const code = (key: string, value: number, file: string, line: number): DataEntry => ({ key, value, source: { kind: 'code', file, commit, line } });

const derived = (key: string, value: number, formula: string, inputs: readonly string[]): DataEntry => ({
  key,
  value,
  source: { kind: 'derived', formula, inputs: [...inputs] },
});

// creature_template: 36626 is the 10-player entry; its difficulty_entry_1 (line 28379) names 37504, the 25-player normal entry.
const CT = (key: string, value: number, column: string): DataEntry => db(key, value, 'creature_template', 'entry 37504', column, 28891);
const CLS = (key: string, value: number, column: string): DataEntry => db(key, value, 'creature_classlevelstats', 'level 83, class 1', column, 381);

const BASE_HP = 13945;
const HEALTH_MODIFIER = 2900;
const BASE_ARMOR = 10643;
const ARMOR_MODIFIER = 1;
const BASE_DAMAGE = 177.074;
const ATTACK_POWER = 805;
const BASE_VARIANCE = 1;
const DAMAGE_MODIFIER = 122.6;
const DEFAULT_ATTACK_TIME_MS = 2000;
const SPEED_RUN = 1.5873;
const PLAYER_RUN_SPEED = 7;
const PUTRICIDE_SPAWN = { x: 4356.19, y: 3262.9, z: 389.482 };
const PUTRICIDE_WATCH = { x: 4324.82, y: 3166.03, z: 389.3831 };
const PUTRICIDE_CHARGE_SPEED = 15;

const melee = creatureMeleeDamage({
  baseDamage: BASE_DAMAGE,
  attackPower: ATTACK_POWER,
  variance: BASE_VARIANCE,
  damageModifier: DAMAGE_MODIFIER,
  attackTimeMs: DEFAULT_ATTACK_TIME_MS,
});
const putricideDistance = Math.hypot(
  PUTRICIDE_SPAWN.x - PUTRICIDE_WATCH.x,
  PUTRICIDE_SPAWN.y - PUTRICIDE_WATCH.y,
  PUTRICIDE_SPAWN.z - PUTRICIDE_WATCH.z,
);

/** Creature values of Festergut, 25-player normal, from the world database, with the values derived from them. */
const CREATURE: readonly DataEntry[] = [
  CT('festergut.level', 83, 'minlevel'),
  CT('festergut.expansion', 2, 'exp'),
  CT('festergut.unit_class', 1, 'unit_class'),
  CT('festergut.speed_run', SPEED_RUN, 'speed_run'),
  CT('festergut.damage_modifier', DAMAGE_MODIFIER, 'DamageModifier'),
  CT('festergut.base_attack_time_db', 0, 'BaseAttackTime'),
  CT('festergut.base_variance', BASE_VARIANCE, 'BaseVariance'),
  CT('festergut.health_modifier', HEALTH_MODIFIER, 'HealthModifier'),
  CT('festergut.armor_modifier', ARMOR_MODIFIER, 'ArmorModifier'),
  CLS('festergut.base_hp', BASE_HP, 'basehp2'),
  CLS('festergut.base_armor', BASE_ARMOR, 'basearmor'),
  CLS('festergut.attack_power', ATTACK_POWER, 'attackpower'),
  CLS('festergut.base_damage', BASE_DAMAGE, 'damage_exp2'),
  db('festergut.display_id', 31006, 'creature_template_model', 'CreatureID 37504, Idx 0', 'CreatureDisplayID', 38525),
  db('festergut.display_scale', 1, 'creature_template_model', 'CreatureID 37504, Idx 0', 'DisplayScale', 38525),
  db('festergut.combat_reach_yd', 8, 'creature_model_info', 'DisplayID 31006', 'CombatReach', 23955),
  db('festergut.bounding_radius_yd', 0.31, 'creature_model_info', 'DisplayID 31006', 'BoundingRadius', 23955),
  db('festergut.spawn_x', 4267.92, 'creature', 'guid 201255 (id1 36626)', 'position_x', 138459),
  db('festergut.spawn_y', 3137.26, 'creature', 'guid 201255 (id1 36626)', 'position_y', 138459),
  // The database stores BaseAttackTime 0 for Festergut; the core replaces 0 by BASE_ATTACK_TIME when it loads the
  // template (ObjectMgr.cpp 1133–1134), and BASE_ATTACK_TIME is 2000 (Unit.h 43).
  code('festergut.default_attack_time_ms', DEFAULT_ATTACK_TIME_MS, 'src/server/game/Entities/Unit/Unit.h', 43),
  derived(
    'festergut.attack_time_ms',
    DEFAULT_ATTACK_TIME_MS,
    'BaseAttackTime, or BASE_ATTACK_TIME when the database value is 0 (ObjectMgr.cpp 1133–1134)',
    ['festergut.base_attack_time_db', 'festergut.default_attack_time_ms'],
  ),
  derived('festergut.health', Math.ceil(BASE_HP * HEALTH_MODIFIER), 'ceil(basehp2 × HealthModifier) (CreatureBaseStats::GenerateHealth, CreatureData.h 313–316)', [
    'festergut.base_hp',
    'festergut.health_modifier',
    'festergut.expansion',
  ]),
  derived('festergut.armor', Math.ceil(BASE_ARMOR * ARMOR_MODIFIER), 'ceil(basearmor × ArmorModifier) (CreatureBaseStats::GenerateArmor, CreatureData.h 327–330)', [
    'festergut.base_armor',
    'festergut.armor_modifier',
  ]),
  derived(
    'festergut.melee_min',
    melee.min,
    'trunc((damage_exp2 + attackpower / 14 × BaseVariance) × DamageModifier × attack time / 1000) (Creature::CalculateMinMaxDamage, StatSystem.cpp 1117; Creature.cpp 1554–1560; Unit.cpp 13306–13309)',
    ['festergut.base_damage', 'festergut.attack_power', 'festergut.base_variance', 'festergut.damage_modifier', 'festergut.attack_time_ms'],
  ),
  derived(
    'festergut.melee_max',
    melee.max,
    'trunc((1.5 × damage_exp2 + attackpower / 14 × BaseVariance) × DamageModifier × attack time / 1000) (Creature::CalculateMinMaxDamage, StatSystem.cpp 1117; Creature.cpp 1554–1560; Unit.cpp 13306–13309)',
    ['festergut.base_damage', 'festergut.attack_power', 'festergut.base_variance', 'festergut.damage_modifier', 'festergut.attack_time_ms'],
  ),
  derived('festergut.speed_yd_s', SPEED_RUN * PLAYER_RUN_SPEED, 'speed_run × base run speed (Creature.cpp 563, Unit.cpp 84)', [
    'festergut.speed_run',
    'core.player_run_speed_yd_s',
  ]),
];

/** Professor Putricide's run to his watch position, after which Festergut applies the first Gaseous Blight (research §2). */
const FIRST_GAS: readonly DataEntry[] = [
  db('putricide.spawn_x', PUTRICIDE_SPAWN.x, 'creature', 'guid 201294 (id1 36678)', 'position_x', 138470),
  db('putricide.spawn_y', PUTRICIDE_SPAWN.y, 'creature', 'guid 201294 (id1 36678)', 'position_y', 138470),
  db('putricide.spawn_z', PUTRICIDE_SPAWN.z, 'creature', 'guid 201294 (id1 36678)', 'position_z', 138470),
  code('putricide.festergut_watch_x', PUTRICIDE_WATCH.x, PP, 150),
  code('putricide.festergut_watch_y', PUTRICIDE_WATCH.y, PP, 150),
  code('putricide.festergut_watch_z', PUTRICIDE_WATCH.z, PP, 150),
  code('putricide.charge_speed_yd_s', PUTRICIDE_CHARGE_SPEED, PP, 473),
  derived(
    'festergut.first_gas_delay_ms',
    Math.trunc((putricideDistance / PUTRICIDE_CHARGE_SPEED) * 1000),
    'trunc(3D distance from Putricide\'s spawn to his Festergut watch position / charge speed × 1000): he charges there on ACTION_FESTERGUT_COMBAT (boss_professor_putricide.cpp 472–474) and Festergut casts Gaseous Blight 69157 on arrival (425–433); the map-update latency of the arrival is not included',
    ['putricide.spawn_x', 'putricide.spawn_y', 'putricide.spawn_z', 'putricide.festergut_watch_x', 'putricide.festergut_watch_y', 'putricide.festergut_watch_z', 'putricide.charge_speed_yd_s'],
  ),
];

const fg = (key: string, value: number, line: number): DataEntry => code(`festergut.${key}`, value, FG, line);

/** Timers and constants of boss_festergut.cpp, each with its line. */
const SCRIPT: readonly DataEntry[] = [
  fg('berserk_ms', 300000, 123),
  fg('inhale_first_min_ms', 25000, 124),
  fg('inhale_first_max_ms', 30000, 124),
  fg('gas_spore_first_min_ms', 20000, 125),
  fg('gas_spore_first_max_ms', 25000, 125),
  fg('vile_gas_first_min_ms', 30000, 126),
  fg('vile_gas_first_max_ms', 40000, 126),
  fg('gastric_bloat_first_min_ms', 12500, 127),
  fg('gastric_bloat_first_max_ms', 15000, 127),
  fg('inhales_before_pungent', 3, 198),
  fg('gas_spore_after_pungent_min_ms', 20000, 204),
  fg('gas_spore_after_pungent_max_ms', 25000, 204),
  fg('inhale_repeat_ms', 34000, 215),
  fg('gas_spore_targets', 3, 220),
  fg('gas_spore_repeat_min_ms', 40000, 221),
  fg('gas_spore_repeat_max_ms', 45000, 221),
  fg('vile_gas_delay_after_spore_ms', 20000, 222),
  fg('vile_gas_min_far_targets', 8, 227),
  fg('vile_gas_far_distance_yd', 5, 228),
  fg('vile_gas_repeat_min_ms', 28000, 235),
  fg('vile_gas_repeat_max_ms', 35000, 235),
  fg('gastric_bloat_repeat_min_ms', 15000, 240),
  fg('gastric_bloat_repeat_max_ms', 17500, 240),
  fg('blighted_spores_fresh_ms', 1000, 327),
  fg('inoculated_once_per_ms', 10000, 334),
  fg('gastric_bloat_explosion_stacks', 10, 361),
];

/** Festergut's data: database, script and derived values, and every spell field of the difficulty's spell variants. */
export function festergutData(difficulty: Difficulty): DataEntry[] {
  if (difficulty !== '25n') throw new Error(`Festergut data exists for 25n only, not ${difficulty} (other difficulties: Gate 4)`);
  return [...CREATURE, ...FIRST_GAS, ...SCRIPT, ...spellDataEntries(FESTERGUT_SPELL_FILE, new FestergutSpells(difficulty).variantIds())];
}

export const FESTERGUT_DATA_25N: readonly DataEntry[] = festergutData('25n');
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test packages/content/test/festergut/data.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add tsconfig.json packages/engine/src/index.ts packages/content
git commit -m "feat(content): Festergut data with sources: spell variants, database values, script timers

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 5: Festergut's spells and auras from the spell data

`addFestergutSpells` builds the 17 spells and 11 auras of the fight (research §1, "25n detail") from registry values only. The test pins every definition against the research table.

**Files:**
- Create: `packages/content/src/festergut/spells.ts`, `packages/content/test/festergut/spells.test.ts`

**Changed behaviour:** none (new module).

How each Spell.dbc effect is expressed (targets A/B from the spell data; research §0 and §1):

| Spell.dbc | Engine |
| --- | --- |
| APPLY_AURA on TARGET_UNIT_CASTER (1) | spell `target: 'self'`, effect `apply_aura` |
| SCHOOL_DAMAGE, SRC_CASTER (22) + UNIT_SRC_AREA_ENEMY (15) | `area` centre `caster`, relation `enemy` |
| …+ UNIT_SRC_AREA_ALLY (30) | `area` centre `caster`, relation `ally` (the caster included unless EXCLUDE_CASTER) |
| DEST_TARGET_ENEMY (53) + UNIT_DEST_AREA_ENEMY (16) | `area` centre `target`, relation `enemy` |
| TRIGGER_SPELL on the caster | `trigger_spell`, `on: 'caster'` |
| FORCE_CAST | `force_cast` inside the area |
| PERIODIC_TRIGGER_SPELL | aura `periodic` with `periodic_trigger` |
| SCRIPT_EFFECT | `script` (inside `on_caster` when its target is the caster) |
| INSTAKILL on the caster | `on_caster` with `instakill` |
| MOD_DAMAGE_PERCENT_DONE / MOD_SCALE / MOD_ATTACKSPEED, MOD_MELEE_HASTE / MOD_AOE_DAMAGE_AVOIDANCE | modifiers `damage_done_pct` / `scale_pct` / `attack_speed_pct` / `aoe_damage_taken_pct`, value from `e<i>.min`, schools from `e<i>.misc_value` |

- [ ] **Step 1: Write the failing test** `packages/content/test/festergut/spells.test.ts`:

```ts
import { DataRegistry } from '@raid/data';
import { CORE_DATA, Catalog } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { FESTERGUT_DATA_25N } from '../../src/festergut/data';
import { FestergutSpells } from '../../src/festergut/spell-ids';
import { addFestergutSpells } from '../../src/festergut/spells';

function build() {
  const data = new DataRegistry([...CORE_DATA, ...FESTERGUT_DATA_25N]);
  const catalog = new Catalog();
  addFestergutSpells(catalog, data, new FestergutSpells('25n'));
  return { data, catalog };
}

describe('Festergut spells from the spell data (research §1, 25n)', () => {
  const { data, catalog } = build();

  it('every reference resolves and every value read has a spelldata or derived source', () => {
    expect(catalog.unresolvedReferences()).toEqual([]);
    const kinds = new Set(data.accessedEntries().map((e) => e.source.kind));
    expect([...kinds].sort()).toEqual(['derived', 'spelldata']);
  });

  it('Gaseous Blight: permanent auras ticking every 2 s, damage to every player in the room', () => {
    expect(catalog.aura('gaseous_blight_large')).toEqual({
      id: 'gaseous_blight_large',
      durationMs: null,
      maxStacks: 1,
      periodic: { intervalMs: 2000, effects: [{ type: 'periodic_trigger', spell: 'gaseous_blight_large_damage' }] },
    });
    const damage = (id: string) => catalog.spell(id).effects[0];
    expect(damage('gaseous_blight_large_damage')).toEqual({
      type: 'area',
      radius: 50000,
      center: 'caster',
      relation: 'enemy',
      playersOnly: true,
      effects: [{ type: 'damage', school: ['shadow'], min: 4388, max: 4612 }],
    });
    expect(damage('gaseous_blight_medium_damage')).toMatchObject({ effects: [{ min: 2925, max: 3075 }] });
    expect(damage('gaseous_blight_small_damage')).toMatchObject({ effects: [{ min: 1463, max: 1537 }] });
  });

  it('Inhale Blight and Inhaled Blight', () => {
    expect(catalog.spell('inhale_blight')).toMatchObject({
      castTimeMs: 3500,
      target: 'self',
      effects: [{ type: 'on_caster', effects: [{ type: 'script' }] }, { type: 'trigger_spell', spell: 'inhaled_blight', on: 'caster' }],
    });
    expect(catalog.aura('inhaled_blight')).toEqual({
      id: 'inhaled_blight',
      durationMs: null,
      maxStacks: 3,
      modifiers: [
        { kind: 'damage_done_pct', pct: 30, perStack: true, schools: ['physical'] },
        { kind: 'scale_pct', pct: 20, perStack: true },
        { kind: 'attack_speed_pct', pct: 30, perStack: true },
      ],
    });
  });

  it('Pungent Blight keeps the effect indices of Spell.dbc', () => {
    const s = catalog.spell('pungent_blight');
    expect(s.castTimeMs).toBe(3000);
    expect(s.effects).toEqual([
      { type: 'area', radius: 50000, center: 'caster', relation: 'enemy', playersOnly: true, effects: [{ type: 'damage', school: ['shadow'], min: 48750, max: 51250 }] },
      { type: 'on_caster', effects: [{ type: 'script' }] },
      { type: 'trigger_spell', spell: 'gaseous_blight_large', on: 'caster' },
    ]);
  });

  it('Gas Spore, its carrier aura and Blighted Spores', () => {
    expect(catalog.spell('gas_spore').effects).toEqual([
      { type: 'area', radius: 50000, center: 'caster', relation: 'enemy', playersOnly: true, effects: [{ type: 'force_cast', spell: 'gas_spore_carrier' }] },
    ]);
    expect(catalog.aura('gas_spore_carrier')).toEqual({
      id: 'gas_spore_carrier',
      durationMs: 12000,
      maxStacks: 1,
      periodic: { intervalMs: 12000, effects: [{ type: 'periodic_trigger', spell: 'blighted_spores' }] },
    });
    expect(catalog.spell('blighted_spores')).toMatchObject({
      ignoreCasterDamageMods: true,
      effects: [{ type: 'area', radius: 8, center: 'caster', relation: 'ally', playersOnly: true, effects: [{ type: 'apply_aura', aura: 'blighted_spores' }] }],
    });
    expect(catalog.aura('blighted_spores')).toEqual({
      id: 'blighted_spores',
      durationMs: 6000,
      maxStacks: 5,
      stackScope: 'unit_replace',
      ignoreCasterDamageMods: true,
      periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: ['shadow'], min: 2925, max: 3075 }] },
    });
  });

  it('Inoculated: 25 % less shadow area damage per stack, death-persistent, castable by and on the dead', () => {
    expect(catalog.spell('inoculated')).toMatchObject({ allowDeadCaster: true, allowDeadTarget: true, effects: [{ type: 'apply_aura', aura: 'inoculated' }] });
    expect(catalog.aura('inoculated')).toEqual({
      id: 'inoculated',
      durationMs: 120000,
      maxStacks: 3,
      deathPersistent: true,
      modifiers: [{ kind: 'aoe_damage_taken_pct', pct: -25, perStack: true, schools: ['shadow'] }],
    });
  });

  it('Vile Gas and its splash', () => {
    expect(catalog.spell('vile_gas')).toMatchObject({
      castTimeMs: 0,
      target: 'unit',
      rangeYd: 50000,
      effects: [{ type: 'area', radius: 8, center: 'target', relation: 'enemy', playersOnly: true, effects: [{ type: 'apply_aura', aura: 'vile_gas' }] }],
    });
    expect(catalog.spell('vile_gas').travelSpeedYdPerSec).toBeUndefined();
    expect(catalog.aura('vile_gas')).toEqual({
      id: 'vile_gas',
      durationMs: 6000,
      maxStacks: 1,
      periodic: {
        intervalMs: 2000,
        effects: [
          { type: 'damage', school: ['nature', 'shadow'], min: 4875, max: 5125 },
          { type: 'periodic_trigger', spell: 'vile_gas_splash' },
        ],
      },
    });
    expect(catalog.spell('vile_gas_splash').effects).toEqual([
      { type: 'area', radius: 8, center: 'caster', relation: 'ally', playersOnly: true, excludeCaster: true, effects: [{ type: 'damage', school: ['nature', 'shadow'], min: 4875, max: 5125 }] },
    ]);
  });

  it('Gastric Bloat and Gastric Explosion', () => {
    expect(catalog.spell('gastric_bloat').effects).toEqual([
      { type: 'damage', school: ['nature', 'shadow'], min: 12188, max: 12812 },
      { type: 'apply_aura', aura: 'gastric_bloat' },
      { type: 'script' },
    ]);
    expect(catalog.aura('gastric_bloat')).toEqual({
      id: 'gastric_bloat',
      durationMs: 100000,
      maxStacks: 10,
      modifiers: [{ kind: 'damage_done_pct', pct: 10, perStack: true, schools: ['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane'] }],
    });
    expect(catalog.spell('gastric_explosion')).toMatchObject({
      ignoreCasterDamageMods: true,
      allowDeadCaster: true,
      effects: [
        { type: 'area', radius: 10, center: 'caster', relation: 'ally', playersOnly: true, effects: [{ type: 'damage', school: ['nature', 'shadow'], min: 29250, max: 30750 }] },
        { type: 'on_caster', effects: [{ type: 'instakill' }] },
      ],
    });
    expect(catalog.spell('gastric_explosion').allowDeadTarget).toBeUndefined();
  });

  it('Berserk', () => {
    expect(catalog.aura('berserk')).toEqual({
      id: 'berserk',
      durationMs: 1800000,
      maxStacks: 1,
      modifiers: [
        { kind: 'damage_done_pct', pct: 900, perStack: false, schools: ['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane'] },
        { kind: 'attack_speed_pct', pct: 150, perStack: false },
        { kind: 'scale_pct', pct: 25, perStack: false },
      ],
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/content/test/festergut/spells.test.ts`
Expected: FAIL, cannot resolve `../../src/festergut/spells`.

- [ ] **Step 3: Write `packages/content/src/festergut/spells.ts`:**

```ts
import type { DataRegistry } from '@raid/data';
import { schoolsOfMask, type AuraModifier, type Catalog, type School, type SpellDef } from '@raid/engine';
import type { FestergutSpellName, FestergutSpells } from './spell-ids';

// Attribute bits (SharedDefines.h at the pinned commit; the line of each flag).
const ATTR0_ALLOW_CAST_WHILE_DEAD = 0x00800000; // 393
const ATTR1_EXCLUDE_CASTER = 0x00080000; // 426
const ATTR2_ALLOW_DEAD_TARGET = 0x00000001; // 444
const ATTR3_ONLY_ON_PLAYER = 0x00000100; // 489
const ATTR3_ALLOW_AURA_WHILE_DEAD = 0x00100000; // 501
const ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS = 0x20000000; // 621

/**
 * Adds every spell and aura of the fight to the catalog. Each number is read from the registry (`spell.<id>.<field>`, the
 * difficulty's variant), so it carries its `spelldata` source and the access is recorded. The position of an effect in
 * `SpellDef.effects` equals its Spell.dbc effect index wherever a spell script hooks an effect.
 *
 * Left out, each named in the mechanic statuses: the FORCE_CAST gas visuals on NPC 36659 (Gaseous Blight e1/e2), Gas
 * Spore's DUMMY aura (e1, radius 0, no target), Inoculated's PERIODIC_DUMMY (e1, value 0), Vile Gas's LINKED slow 69248
 * (e1) and missile speed, the splash's 1 s root (e1).
 */
export function addFestergutSpells(catalog: Catalog, data: DataRegistry, spells: FestergutSpells): void {
  const n = (name: FestergutSpellName, field: string): number => spells.num(data, name, field);
  const flag = (name: FestergutSpellName, field: string, bit: number): boolean => (n(name, field) & bit) !== 0;
  const schools = (name: FestergutSpellName): School[] => schoolsOfMask(n(name, 'school_mask'));
  const range = (name: FestergutSpellName, e: number) => ({ min: n(name, `e${e}.min`), max: n(name, `e${e}.max`) });
  /** SpellDuration -1 is a permanent aura. */
  const duration = (name: FestergutSpellName): number | null => (n(name, 'duration_ms') < 0 ? null : n(name, 'duration_ms'));
  /** The engine id of the spell an effect triggers. */
  const triggered = (name: FestergutSpellName, e: number): FestergutSpellName => spells.id(n(name, `e${e}.trigger_spell`));
  const playersOnly = (name: FestergutSpellName): boolean => flag(name, 'attributes_ex3', ATTR3_ONLY_ON_PLAYER);
  const ignoreCasterDamageMods = (name: FestergutSpellName): boolean => flag(name, 'attributes_ex6', ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS);
  /** Fields every boss spell shares: no global cooldown, no cooldown, castable while moving. */
  const spell = (name: FestergutSpellName, target: 'self' | 'unit', rest: Pick<SpellDef, 'effects'> & Partial<SpellDef>): SpellDef => ({
    id: name,
    castTimeMs: n(name, 'cast_time_ms'),
    gcdMs: 0,
    cooldownMs: 0,
    rangeYd: target === 'self' ? 0 : n(name, 'range_yd'),
    usableWhileMoving: true,
    target,
    ...rest,
  });
  const stacks = (name: FestergutSpellName): number => Math.max(1, n(name, 'max_stacks'));

  // Ambient Gaseous Blight: a permanent aura on Festergut whose tick makes him cast the damage spell at the room.
  for (const size of ['large', 'medium', 'small'] as const) {
    const aura: FestergutSpellName = `gaseous_blight_${size}`;
    const damage = triggered(aura, 0);
    catalog.addSpell(spell(aura, 'self', { effects: [{ type: 'apply_aura', aura }] }));
    catalog.addAura({
      id: aura,
      durationMs: duration(aura),
      maxStacks: stacks(aura),
      periodic: { intervalMs: n(aura, 'e0.amplitude_ms'), effects: [{ type: 'periodic_trigger', spell: damage }] },
    });
    catalog.addSpell(
      spell(damage, 'self', {
        effects: [
          {
            type: 'area',
            radius: n(damage, 'e0.radius_yd'),
            center: 'caster',
            relation: 'enemy',
            playersOnly: playersOnly(damage),
            effects: [{ type: 'damage', school: schools(damage), ...range(damage, 0) }],
          },
        ],
      }),
    );
  }

  // Inhale Blight: e0 SCRIPT_EFFECT without a script, e1 TRIGGER_SPELL Inhaled Blight on the caster.
  catalog.addSpell(
    spell('inhale_blight', 'self', {
      effects: [
        { type: 'on_caster', effects: [{ type: 'script' }] },
        { type: 'trigger_spell', spell: triggered('inhale_blight', 1), on: 'caster' },
      ],
    }),
  );
  catalog.addSpell(spell('inhaled_blight', 'self', { effects: [{ type: 'apply_aura', aura: 'inhaled_blight' }] }));
  catalog.addAura({
    id: 'inhaled_blight',
    durationMs: duration('inhaled_blight'),
    maxStacks: stacks('inhaled_blight'),
    modifiers: [
      // e0 MOD_DAMAGE_PERCENT_DONE, misc value = school mask (physical).
      { kind: 'damage_done_pct', pct: n('inhaled_blight', 'e0.min'), perStack: true, schools: schoolsOfMask(n('inhaled_blight', 'e0.misc_value')) },
      // e1 MOD_SCALE, e2 MOD_ATTACKSPEED.
      { kind: 'scale_pct', pct: n('inhaled_blight', 'e1.min'), perStack: true },
      { kind: 'attack_speed_pct', pct: n('inhaled_blight', 'e2.min'), perStack: true },
    ],
  });

  // Pungent Blight: e0 damage to every player, e1 SCRIPT_EFFECT on the caster, e2 TRIGGER_SPELL large Gaseous Blight.
  catalog.addSpell(
    spell('pungent_blight', 'self', {
      effects: [
        {
          type: 'area',
          radius: n('pungent_blight', 'e0.radius_yd'),
          center: 'caster',
          relation: 'enemy',
          playersOnly: playersOnly('pungent_blight'),
          effects: [{ type: 'damage', school: schools('pungent_blight'), ...range('pungent_blight', 0) }],
        },
        { type: 'on_caster', effects: [{ type: 'script' }] },
        { type: 'trigger_spell', spell: triggered('pungent_blight', 2), on: 'caster' },
      ],
    }),
  );

  // Gas Spore: e0 FORCE_CAST of the carrier aura on players in the room; the script limits it to 3 targets.
  catalog.addSpell(
    spell('gas_spore', 'self', {
      effects: [
        {
          type: 'area',
          radius: n('gas_spore', 'e0.radius_yd'),
          center: 'caster',
          relation: 'enemy',
          playersOnly: playersOnly('gas_spore'),
          effects: [{ type: 'force_cast', spell: triggered('gas_spore', 0) }],
        },
      ],
    }),
  );
  // The carrier aura: one tick at its expiry makes the carrier cast Blighted Spores.
  catalog.addSpell(spell('gas_spore_carrier', 'self', { effects: [{ type: 'apply_aura', aura: 'gas_spore_carrier' }] }));
  catalog.addAura({
    id: 'gas_spore_carrier',
    durationMs: duration('gas_spore_carrier'),
    maxStacks: stacks('gas_spore_carrier'),
    periodic: { intervalMs: n('gas_spore_carrier', 'e0.amplitude_ms'), effects: [{ type: 'periodic_trigger', spell: triggered('gas_spore_carrier', 0) }] },
  });
  // Blighted Spores: a shadow DoT on every player within 8 yd of the carrier, the carrier included.
  catalog.addSpell(
    spell('blighted_spores', 'self', {
      ignoreCasterDamageMods: ignoreCasterDamageMods('blighted_spores'),
      effects: [
        {
          type: 'area',
          radius: n('blighted_spores', 'e0.radius_yd'),
          center: 'caster',
          relation: 'ally',
          playersOnly: playersOnly('blighted_spores'),
          effects: [{ type: 'apply_aura', aura: 'blighted_spores' }],
        },
      ],
    }),
  );
  catalog.addAura({
    id: 'blighted_spores',
    durationMs: duration('blighted_spores'),
    maxStacks: stacks('blighted_spores'),
    // An area aura: another carrier's copy replaces this one (research §3, A-016).
    stackScope: 'unit_replace',
    ignoreCasterDamageMods: ignoreCasterDamageMods('blighted_spores'),
    periodic: { intervalMs: n('blighted_spores', 'e0.amplitude_ms'), effects: [{ type: 'damage', school: schools('blighted_spores'), ...range('blighted_spores', 0) }] },
  });

  // Inoculated: e0 MOD_AOE_DAMAGE_AVOIDANCE per stack for the schools of its misc value (shadow); death-persistent.
  const inoculatedDeadTarget = flag('inoculated', 'attributes_ex2', ATTR2_ALLOW_DEAD_TARGET);
  catalog.addSpell(
    spell('inoculated', 'self', {
      allowDeadCaster: flag('inoculated', 'attributes', ATTR0_ALLOW_CAST_WHILE_DEAD),
      allowDeadTarget: inoculatedDeadTarget,
      effects: [{ type: 'apply_aura', aura: 'inoculated' }],
    }),
  );
  const inoculated: AuraModifier = { kind: 'aoe_damage_taken_pct', pct: n('inoculated', 'e0.min'), perStack: true, schools: schoolsOfMask(n('inoculated', 'e0.misc_value')) };
  catalog.addAura({
    id: 'inoculated',
    durationMs: duration('inoculated'),
    maxStacks: stacks('inoculated'),
    deathPersistent: flag('inoculated', 'attributes_ex3', ATTR3_ALLOW_AURA_WHILE_DEAD),
    modifiers: [inoculated],
  });

  // Vile Gas: an aura on every player within 8 yd of the target: a DoT (e0) and a splash cast by the victim (e2).
  if (n('vile_gas', 'e0.amplitude_ms') !== n('vile_gas', 'e2.amplitude_ms')) throw new Error('Vile Gas: the DoT and the splash need the same amplitude');
  catalog.addSpell(
    spell('vile_gas', 'unit', {
      effects: [
        {
          type: 'area',
          radius: n('vile_gas', 'e0.radius_yd'),
          center: 'target',
          relation: 'enemy',
          playersOnly: playersOnly('vile_gas'),
          effects: [{ type: 'apply_aura', aura: 'vile_gas' }],
        },
      ],
    }),
  );
  catalog.addAura({
    id: 'vile_gas',
    durationMs: duration('vile_gas'),
    maxStacks: stacks('vile_gas'),
    periodic: {
      intervalMs: n('vile_gas', 'e0.amplitude_ms'),
      effects: [
        { type: 'damage', school: schools('vile_gas'), ...range('vile_gas', 0) },
        { type: 'periodic_trigger', spell: triggered('vile_gas', 2) },
      ],
    },
  });
  catalog.addSpell(
    spell('vile_gas_splash', 'self', {
      effects: [
        {
          type: 'area',
          radius: n('vile_gas_splash', 'e0.radius_yd'),
          center: 'caster',
          relation: 'ally',
          playersOnly: playersOnly('vile_gas_splash'),
          excludeCaster: flag('vile_gas_splash', 'attributes_ex', ATTR1_EXCLUDE_CASTER),
          effects: [{ type: 'damage', school: schools('vile_gas_splash'), ...range('vile_gas_splash', 0) }],
        },
      ],
    }),
  );

  // Gastric Bloat: e0 damage, e1 MOD_DAMAGE_PERCENT_DONE per stack on the victim, e2 SCRIPT_EFFECT (the explosion check).
  catalog.addSpell(
    spell('gastric_bloat', 'unit', {
      effects: [{ type: 'damage', school: schools('gastric_bloat'), ...range('gastric_bloat', 0) }, { type: 'apply_aura', aura: 'gastric_bloat' }, { type: 'script' }],
    }),
  );
  catalog.addAura({
    id: 'gastric_bloat',
    durationMs: duration('gastric_bloat'),
    maxStacks: stacks('gastric_bloat'),
    modifiers: [{ kind: 'damage_done_pct', pct: n('gastric_bloat', 'e1.min'), perStack: true, schools: schoolsOfMask(n('gastric_bloat', 'e1.misc_value')) }],
  });
  // Gastric Explosion, cast by the tank: e0 damage to players within 10 yd (the tank included), e1 INSTAKILL on the caster.
  catalog.addSpell(
    spell('gastric_explosion', 'self', {
      ignoreCasterDamageMods: ignoreCasterDamageMods('gastric_explosion'),
      allowDeadCaster: flag('gastric_explosion', 'attributes', ATTR0_ALLOW_CAST_WHILE_DEAD),
      effects: [
        {
          type: 'area',
          radius: n('gastric_explosion', 'e0.radius_yd'),
          center: 'caster',
          relation: 'ally',
          playersOnly: playersOnly('gastric_explosion'),
          effects: [{ type: 'damage', school: schools('gastric_explosion'), ...range('gastric_explosion', 0) }],
        },
        { type: 'on_caster', effects: [{ type: 'instakill' }] },
      ],
    }),
  );

  // Berserk: e0 MOD_DAMAGE_PERCENT_DONE (all schools), e1 MOD_MELEE_HASTE, e2 MOD_SCALE.
  catalog.addSpell(spell('berserk', 'self', { effects: [{ type: 'apply_aura', aura: 'berserk' }] }));
  catalog.addAura({
    id: 'berserk',
    durationMs: duration('berserk'),
    maxStacks: stacks('berserk'),
    modifiers: [
      { kind: 'damage_done_pct', pct: n('berserk', 'e0.min'), perStack: false, schools: schoolsOfMask(n('berserk', 'e0.misc_value')) },
      { kind: 'attack_speed_pct', pct: n('berserk', 'e1.min'), perStack: false },
      { kind: 'scale_pct', pct: n('berserk', 'e2.min'), perStack: false },
    ],
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/content/test/festergut/spells.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/content
git commit -m "feat(content): Festergut spells and auras built from the client spell data

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 6: The Festergut script and boss module (adds A-036, A-037)

`FestergutAI` ports `boss_festergutAI` (`FG` 89–267): the engage schedule, the first gas, the event switch, `SetData`/`GetData`, the mechanic statuses. `boss.ts` is the `BossModule`: the unit from the database values, the catalog, the engage with a puller (A-033). The three spell and aura scripts follow in Tasks 7 to 9; the tests of this task do not depend on them.

**Files:**
- Create: `packages/content/src/festergut/ai.ts`, `packages/content/src/festergut/boss.ts`, `packages/content/test/festergut/fight.ts`, `packages/content/test/festergut/script.test.ts`
- Modify: `packages/content/src/index.ts`, `docs/adaptations.md`

**Changed behaviour:** none for existing scenarios (a new boss in the registry).

Semantics the tests rely on: an event that becomes due is executed at the next AI update (10 ms, A-002), so times are `n × 10`; no event executes while Festergut casts (spec §5.1), so Inhale Blight's 3.5 s cast can hold Gastric Bloat or Berserk back; Gas Spore's `delayEventsToMax` only moves a Vile Gas that was due earlier.

- [ ] **Step 1: Write the test helper** `packages/content/test/festergut/fight.ts`:

```ts
import { DataRegistry } from '@raid/data';
import { CORE_DATA, Simulation, ThreatManager, engageEncounter, installCoreRules, type Role, type TraceEvent } from '@raid/engine';
import type { FestergutAI } from '../../src/festergut/ai';
import { festergut } from '../../src/festergut/boss';

/** Festergut's spawn (creature.sql line 138459); test players are placed relative to it. */
export const BOSS = { x: 4267.92, y: 3137.26 };

export interface TestPlayer {
  readonly id: string;
  readonly role?: Exclude<Role, 'boss' | 'add'>;
  /** Position relative to Festergut, in yards. */
  readonly dx: number;
  readonly dy: number;
  readonly maxHealth?: number;
  readonly armor?: number;
}

export interface FightOptions {
  readonly seed?: number;
  readonly maxDurationMs: number;
  readonly players: readonly TestPlayer[];
}

/** The tank in melee range and `count` players on a circle of `radius` yards around Festergut, ids r01, r02, … */
export function ring(count: number, radius: number, extra: readonly TestPlayer[] = []): TestPlayer[] {
  const out: TestPlayer[] = [{ id: 't1', role: 'tank', dx: 0, dy: -9.5 }];
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count;
    out.push({ id: `r${String(i + 1).padStart(2, '0')}`, role: 'ranged', dx: radius * Math.cos(a), dy: radius * Math.sin(a) });
  }
  return [...out, ...extra];
}

/**
 * A Festergut fight without a plan: the boss module is set up as in a run, the players only stand where they are put.
 * They have 100 million health unless a test says otherwise, so the boss's behaviour can be watched undisturbed.
 */
export function newFight(options: FightOptions) {
  const data = new DataRegistry([...CORE_DATA, ...festergut.data]);
  const sim = new Simulation({ seed: options.seed ?? 1, maxDurationMs: options.maxDurationMs, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  new ThreatManager(sim, data.num('core.threat_update_interval_ms')).install();
  const setup = festergut.setup({ sim, data, difficulty: '25n' });
  for (const p of options.players) {
    sim.addUnit({
      id: p.id,
      name: p.id,
      kind: 'player',
      role: p.role ?? 'ranged',
      maxHealth: p.maxHealth ?? 100_000_000,
      armor: p.armor ?? 0,
      pos: { x: BOSS.x + p.dx, y: BOSS.y + p.dy },
      speedYdPerSec: data.num('core.player_run_speed_yd_s'),
      combatReach: data.num('core.player_combat_reach_yd'),
      boundingRadius: data.num('core.player_bounding_radius_yd'),
    });
  }
  engageEncounter(sim, setup.script, setup.bossUnitId, data.num('core.ai_update_interval_ms'), setup.puller!(sim));
  const events = (kind: TraceEvent['kind'], where: Readonly<Record<string, unknown>> = {}): TraceEvent[] =>
    sim.trace.list().filter((e) => e.kind === kind && Object.entries(where).every(([k, v]) => e.data[k] === v));
  return { sim, data, ai: setup.script as FestergutAI, boss: sim.unit(setup.bossUnitId), events };
}
```

- [ ] **Step 2: Write the failing test** `packages/content/test/festergut/script.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FESTERGUT_MECHANICS } from '../../src/festergut/ai';
import { newFight, ring, type TestPlayer } from './fight';

/** The AI update interval: a timer is noticed up to one update late (A-002). */
const STEP = 10;
/** No event executes while Festergut casts (spec §5.1): Inhale Blight can hold a due event back by its 3.5 s cast time. */
const CAST_HOLD = 3500;
const between = (v: number, min: number, max: number): boolean => v >= min && v <= max;

describe('Festergut script: engage and the first gas', () => {
  const f = newFight({ maxDurationMs: 12000, players: ring(12, 30) });
  f.sim.run();

  it('engages on the pulling tank and publishes the timer windows of boss_festergut.cpp 123–127', () => {
    expect(f.events('engage')[0].data).toEqual({ boss: 'festergut', who: 't1' });
    expect(f.events('timer_window').filter((e) => e.t === 0).map((e) => [e.data.ability, e.data.earliestMs, e.data.latestMs])).toEqual([
      ['berserk', 300000, 300000],
      ['inhale_blight', 25000, 30000],
      ['gas_spore', 20000, 25000],
      ['vile_gas', 30000, 40000],
      ['gastric_bloat', 12500, 15000],
    ]);
  });

  it('gets the large Gaseous Blight 6788 ms after the engage, at the next AI update (A-036)', () => {
    const applied = f.events('aura_applied', { aura: 'gaseous_blight_large', unit: 'festergut' });
    expect(applied.map((e) => e.t)).toEqual([6790]);
    expect(f.events('cast_start', { spell: 'gaseous_blight_large' })[0].data).toMatchObject({ caster: 'festergut', triggered: true });
  });

  it('the gas ticks every 2 s on every player for 4388 to 4612 shadow damage', () => {
    const ticks = f.events('damage', { ability: 'gaseous_blight_large_damage' });
    expect([...new Set(ticks.map((e) => e.t))]).toEqual([8790, 10790]);
    expect(ticks.filter((e) => e.t === 8790).map((e) => e.data.target).sort()).toEqual(ring(12, 30).map((p) => p.id).sort());
    expect(ticks.every((e) => e.data.source === 'festergut' && e.data.school === 'shadow' && between(Number(e.data.amount), 4388, 4612))).toBe(true);
  });

  it('melee: 57,517 to 79,226 on a victim without armor, one swing per 2 s', () => {
    const swings = [...f.events('damage', { ability: 'melee' }), ...f.events('melee_avoided')].sort((a, b) => a.t - b.t);
    expect(swings.map((e) => e.t)).toEqual([10, 2010, 4010, 6010, 8010, 10010]);
    expect(f.events('damage', { ability: 'melee' }).every((e) => e.data.target === 't1' && between(Number(e.data.amount), 57517, 79226))).toBe(true);
  });
});

describe('Festergut script: the inhale cycle', () => {
  const f = newFight({ maxDurationMs: 140000, players: ring(12, 30) });
  f.sim.run();
  const inhales = f.events('ai_event', { event: 'inhale_blight' });
  const first = inhales[0].t;

  it('inhales after 25 to 30 s and then every 34 s; the fourth event is Pungent Blight', () => {
    expect(between(first, 25000, 30000 + STEP)).toBe(true);
    expect(inhales.map((e) => e.t - first)).toEqual([0, 34000, 68000, 102000]);
    expect(inhales.map((e) => e.data.inhales)).toEqual([0, 1, 2, 3]);
    const casts = f.events('cast_start').filter((e) => e.data.spell === 'inhale_blight' || e.data.spell === 'pungent_blight');
    expect(casts.map((e) => [e.t - first, e.data.spell, e.data.castTimeMs])).toEqual([
      [0, 'inhale_blight', 3500],
      [34000, 'inhale_blight', 3500],
      [68000, 'inhale_blight', 3500],
      [102000, 'pungent_blight', 3000],
    ]);
  });

  it('the gas steps down without a gap: large, medium, small, none', () => {
    const gas = [...f.events('aura_applied'), ...f.events('aura_removed')]
      .filter((e) => e.data.unit === 'festergut' && String(e.data.aura).startsWith('gaseous_blight') && e.t < first + 102000)
      .sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)))
      .map((e) => [e.t === 6790 ? 'first gas' : e.t - first, e.kind, e.data.aura]);
    expect(gas).toEqual([
      ['first gas', 'aura_applied', 'gaseous_blight_large'],
      [0, 'aura_removed', 'gaseous_blight_large'],
      [0, 'aura_applied', 'gaseous_blight_medium'],
      [34000, 'aura_removed', 'gaseous_blight_medium'],
      [34000, 'aura_applied', 'gaseous_blight_small'],
      [68000, 'aura_removed', 'gaseous_blight_small'],
    ]);
    // No ambient damage between the third inhale and Pungent Blight.
    const ambient = f.sim.trace.list().filter((e) => e.kind === 'damage' && String(e.data.ability).startsWith('gaseous_blight') && e.t > first + 68000 && e.t < first + 105000);
    expect(ambient).toEqual([]);
  });

  it('each inhale gives one Inhaled Blight stack when its cast ends', () => {
    const stacks = [...f.events('aura_applied', { aura: 'inhaled_blight' }), ...f.events('aura_stack', { aura: 'inhaled_blight' })];
    expect(stacks.map((e) => [e.t - first, e.data.stacks])).toEqual([
      [3500, 1],
      [37500, 2],
      [71500, 3],
    ]);
  });

  it('three stacks: reach 8 × 1.6, swings every 1052 ms, 90 % more melee damage', () => {
    const at = first + 80000;
    const probe = newFight({ maxDurationMs: at, players: ring(12, 30) });
    probe.sim.run();
    expect(probe.boss.combatReach).toBeCloseTo(12.8, 10);
    // 2000 ms × 100 / (100 + 3 × 30) = 1052.6 → 1052 (A-031).
    const swings = [...probe.events('damage', { ability: 'melee' }), ...probe.events('melee_avoided')].filter((e) => e.t > first + 72000).map((e) => e.t);
    expect(swings[2] - swings[1]).toBe(1060);
    const hits = probe.events('damage', { ability: 'melee' }).filter((e) => e.t > first + 72000);
    expect(hits.length).toBeGreaterThan(0);
    // trunc(57,517 × 1.9) = 109,282; trunc(79,226 × 1.9) = 150,529.
    expect(hits.every((e) => between(Number(e.data.amount), 109282, 150529))).toBe(true);
  });

  it('the window of the next inhale event carries the name of what it will cast', () => {
    const names = f.events('timer_window').filter((e) => (e.data.ability === 'inhale_blight' || e.data.ability === 'pungent_blight') && e.t > 0);
    expect(names.map((e) => [e.t - first, e.data.ability, e.data.cleared === true ? 'cleared' : Number(e.data.earliestMs) - first])).toEqual([
      [0, 'inhale_blight', 34000],
      [34000, 'inhale_blight', 68000],
      [68000, 'inhale_blight', 'cleared'],
      [68000, 'pungent_blight', 102000],
      [102000, 'pungent_blight', 'cleared'],
      [102000, 'inhale_blight', 136000],
    ]);
  });
});

describe('Festergut script: Gastric Bloat, Gas Spore, Vile Gas, Berserk', () => {
  const f = newFight({ maxDurationMs: 100000, players: ring(12, 30) });
  f.sim.run();

  it('Gastric Bloat: on the victim after 12.5 to 15 s, then every 15 to 17.5 s, one stack each', () => {
    const casts = f.events('cast_start', { spell: 'gastric_bloat' });
    expect(casts.every((e) => e.data.target === 't1')).toBe(true);
    expect(between(casts[0].t, 12500, 15000 + STEP)).toBe(true);
    for (let i = 1; i < casts.length; i++) expect(between(casts[i].t - casts[i - 1].t, 15000, 17500 + CAST_HOLD + STEP), `gap ${i}`).toBe(true);
    expect(between(Number(f.events('damage', { ability: 'gastric_bloat' })[0].data.amount), 12188, 12812)).toBe(true);
    const stacks = [...f.events('aura_applied', { aura: 'gastric_bloat' }), ...f.events('aura_stack', { aura: 'gastric_bloat' })].map((e) => e.data.stacks);
    expect(stacks).toEqual(casts.map((_, i) => i + 1));
  });

  it('Gas Spore: three random players carry it for 12 s; repeats after 40 to 45 s', () => {
    const casts = f.events('cast_start', { spell: 'gas_spore' });
    expect(between(casts[0].t, 20000, 25000 + STEP)).toBe(true);
    expect(between(casts[1].t - casts[0].t, 40000, 45000 + STEP)).toBe(true);
    for (const cast of casts) {
      const carriers = f.events('aura_applied', { aura: 'gas_spore_carrier' }).filter((e) => e.t === cast.t);
      expect(carriers).toHaveLength(3);
      expect(carriers.every((e) => e.data.caster === e.data.unit && e.data.expiresMs === cast.t + 12000)).toBe(true);
    }
  });

  it('Gas Spore delays Vile Gas to 20 s after it, and the Vile Gas window follows', () => {
    const spore = f.events('cast_start', { spell: 'gas_spore' })[0].t;
    // The first Vile Gas was due after 30 to 40 s; a spore at 20 to 25 s pushes both bounds to spore + 20 s when they were earlier.
    const window = f.events('timer_window', { ability: 'vile_gas' }).find((e) => e.t === spore);
    expect(window?.data.earliestMs).toBe(Math.max(30000, spore + 20000));
    expect(window?.data.latestMs).toBe(Math.max(40000, spore + 20000));
    const vile = f.events('cast_start', { spell: 'vile_gas' })[0];
    expect(vile.t).toBeGreaterThanOrEqual(spore + 20000);
    expect(between(vile.t, Number(window?.data.earliestMs), Number(window?.data.latestMs) + STEP)).toBe(true);
  });

  it('Vile Gas prefers players at least 5 yd away when 8 of them exist', () => {
    const picks = f.events('ai_event', { event: 'vile_gas' });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((e) => e.data.farTargets === 12 && e.data.target !== 't1')).toBe(true);
  });

  it('with fewer than 8 far players it takes anyone on the threat list, the tank included', () => {
    const few = newFight({ maxDurationMs: 250000, players: ring(4, 30) });
    few.sim.run();
    const picks = few.events('ai_event', { event: 'vile_gas' });
    expect(picks.every((e) => e.data.farTargets === 4)).toBe(true);
    expect(new Set(picks.map((e) => e.data.target)).has('t1')).toBe(true);
  });

  it('Vile Gas: an aura on everyone within 8 yd of the target, 3 ticks, each with a splash cast by the victim', () => {
    // Eight players on one spot 30 yd out: whoever is picked, all eight get the aura.
    const group: TestPlayer[] = Array.from({ length: 8 }, (_, i) => ({ id: `g${i + 1}`, dx: 30, dy: 0 }));
    const g = newFight({ maxDurationMs: 60000, players: [{ id: 't1', role: 'tank', dx: 0, dy: -9.5 }, ...group] });
    g.sim.run();
    const cast = g.events('cast_start', { spell: 'vile_gas' })[0];
    const auras = g.events('aura_applied', { aura: 'vile_gas' }).filter((e) => e.t === cast.t);
    expect(auras.map((e) => e.data.unit).sort()).toEqual(group.map((p) => p.id));
    expect(auras.every((e) => e.data.caster === 'festergut')).toBe(true);
    const ticks = g.events('periodic_tick', { aura: 'vile_gas', unit: 'g1' }).filter((e) => e.t <= cast.t + 6000);
    expect(ticks.map((e) => e.t - cast.t)).toEqual([2000, 4000, 6000]);
    const dot = g.events('damage', { ability: 'vile_gas', target: 'g1' }).filter((e) => e.t <= cast.t + 6000);
    expect(dot).toHaveLength(3);
    // 4875 to 5125, or 25 % less (from 3656) for a player who already has an Inoculated stack from the first spores.
    expect(dot.every((e) => e.data.school === 'nature+shadow' && between(Number(e.data.amount), 3656, 5125))).toBe(true);
    // The splash: cast by each victim, owned by Festergut, hits the seven others and never its caster.
    const splashCasts = g.events('cast_start', { spell: 'vile_gas_splash' }).filter((e) => e.t === cast.t + 2000);
    expect(splashCasts).toHaveLength(8);
    expect(splashCasts.every((e) => e.data.originalCaster === 'festergut' && e.data.triggered === true)).toBe(true);
    const hits = g.events('spell_hit', { spell: 'vile_gas_splash' }).filter((e) => e.t === cast.t + 2000);
    expect(hits).toHaveLength(8 * 7);
    expect(hits.every((e) => e.data.caster !== e.data.target)).toBe(true);
    const splash = g.events('damage', { ability: 'vile_gas_splash' }).filter((e) => e.t === cast.t + 2000);
    expect(splash.every((e) => e.data.source === 'festergut' && between(Number(e.data.amount), 3656, 5125))).toBe(true);
  });

  it('Berserk after 5 minutes: ten times the damage, 2.5 times the attack speed', () => {
    const b = newFight({ maxDurationMs: 303000, players: ring(12, 30) });
    b.sim.run();
    const cast = b.events('cast_start', { spell: 'berserk' })[0];
    expect(between(cast.t, 300000, 300000 + CAST_HOLD + STEP)).toBe(true);
    expect(cast.data).toMatchObject({ caster: 'festergut', triggered: true });
    expect(b.events('aura_applied', { aura: 'berserk', unit: 'festergut' })).toHaveLength(1);
    const gas = b.sim.trace.list().filter((e) => e.kind === 'damage' && String(e.data.ability).startsWith('gaseous_blight') && e.t > cast.t);
    const before = b.sim.trace.list().filter((e) => e.kind === 'damage' && e.data.ability === gas[0].data.ability && e.t < cast.t && e.data.target === gas[0].data.target);
    expect(Number(gas[0].data.amount)).toBeGreaterThan(5 * Number(before[before.length - 1].data.amount));
  });
});

describe('Festergut mechanic statuses (spec §6.1, notes for Plan 2b-2)', () => {
  it('lists every omission', () => {
    const omissions = FESTERGUT_MECHANICS.flatMap((m) => m.omissions).join('\n');
    for (const needle of ['hit and resist', 'could crit', 'missile travel time', '1 s root', 'LINKED slow', 'keeps the tick schedule', 'gas visuals', 'PERIODIC_DUMMY', 'DUMMY aura of Gas Spore']) {
      expect(omissions, needle).toContain(needle);
    }
    expect(FESTERGUT_MECHANICS.every((m) => m.validation === 'azerothcore_source' && (m.status === 'implemented') === (m.omissions.length === 0))).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test packages/content/test/festergut/script.test.ts`
Expected: FAIL, cannot resolve `../../src/festergut/ai`.

- [ ] **Step 4: Write `packages/content/src/festergut/ai.ts`:**

```ts
import type { DataRegistry } from '@raid/data';
import { EventScriptedAI, removeAuras, type BossContext, type MechanicStatus, type Unit } from '@raid/engine';
import type { FestergutSpellName } from './spell-ids';

export const FESTERGUT_ID = 'festergut';

// Event ids as in boss_festergut.cpp 68–77.
const EVENT_BERSERK = 1;
const EVENT_INHALE_BLIGHT = 2;
const EVENT_VILE_GAS = 3;
const EVENT_GAS_SPORE = 4;
const EVENT_GASTRIC_BLOAT = 5;
/** EventMap group of Vile Gas (boss_festergut.cpp 126, 235), which Gas Spore delays (222). */
const GROUP_VILE_GAS = 1;

/** boss_festergut.cpp 63: the ambient blight applied after the first and the second inhale; none after the third. */
const GASEOUS_BLIGHT: readonly FestergutSpellName[] = ['gaseous_blight_large', 'gaseous_blight_medium', 'gaseous_blight_small'];

/** `DATA_INOCULATED_STACK` (boss_festergut.cpp 66): the highest Inoculated stack a player reached. */
export const DATA_INOCULATED_STACK = 69291;

const SOURCE = 'azerothcore_source' as const;
const HIT = 'spell hit and resist rolls are not modelled: the spell always lands in full';

export const FESTERGUT_MECHANICS: readonly MechanicStatus[] = [
  {
    key: 'festergut.gaseous_blight',
    status: 'partial',
    omissions: [
      HIT,
      'the gas visuals (FORCE_CAST 69126/69152/69154 on the gas dummy, NPC 36659) are left out: areas cannot filter by creature entry',
      'Professor Putricide is not a unit: the first gas is applied after a fixed delay (festergut.first_gas_delay_ms), without the map-update latency of his arrival',
      'the quest script of the damage spell (Residue Rendezvous) is left out',
    ],
    validation: SOURCE,
  },
  { key: 'festergut.inhale_blight', status: 'implemented', omissions: [], validation: SOURCE },
  { key: 'festergut.pungent_blight', status: 'implemented', omissions: [], validation: SOURCE },
  {
    key: 'festergut.gas_spore',
    status: 'partial',
    omissions: ['the DUMMY aura of Gas Spore (effect 1, radius 0, no target) is left out', `Blighted Spores: ${HIT}`],
    validation: SOURCE,
  },
  {
    key: 'festergut.inoculated',
    status: 'partial',
    omissions: ['the PERIODIC_DUMMY effect of Inoculated (effect 1, value 0) is left out', 'the achievement Flu Shot Shortage is not evaluated; the highest stack is recorded'],
    validation: SOURCE,
  },
  {
    key: 'festergut.vile_gas',
    status: 'partial',
    omissions: [
      HIT,
      'the missile travel time (20 yd/s) is left out: Vile Gas lands at once',
      'the 1 s root of the splash (71288 effect 1) is left out',
      'the LINKED slow and confuse aura 69248 is left out',
      're-applying Vile Gas to a player who has it keeps the tick schedule; AzerothCore restarts it (A-009)',
    ],
    validation: SOURCE,
  },
  { key: 'festergut.gastric_bloat', status: 'implemented', omissions: [], validation: SOURCE },
  {
    key: 'festergut.gastric_explosion',
    status: 'partial',
    omissions: ['Gastric Explosion is cast by a player and could crit; crits are not modelled (A-028)'],
    validation: SOURCE,
  },
  {
    key: 'festergut.melee',
    status: 'partial',
    omissions: ['no crits, crushing blows or block (A-022)', 'Festergut does not move: he does not chase his victim'],
    validation: SOURCE,
  },
  { key: 'festergut.berserk', status: 'implemented', omissions: [], validation: SOURCE },
];

export interface FestergutTimers {
  readonly berserkMs: number;
  readonly inhaleFirst: readonly [number, number];
  readonly inhaleRepeatMs: number;
  readonly inhalesBeforePungent: number;
  readonly gasSporeFirst: readonly [number, number];
  readonly gasSporeRepeat: readonly [number, number];
  readonly gasSporeAfterPungent: readonly [number, number];
  readonly gasSporeTargets: number;
  readonly vileGasFirst: readonly [number, number];
  readonly vileGasRepeat: readonly [number, number];
  readonly vileGasDelayAfterSporeMs: number;
  readonly vileGasMinFarTargets: number;
  readonly vileGasFarDistanceYd: number;
  readonly gastricBloatFirst: readonly [number, number];
  readonly gastricBloatRepeat: readonly [number, number];
  readonly firstGasDelayMs: number;
}

/** Reads the script's timers and constants from the registry (`code` sources with their line in boss_festergut.cpp). */
export function festergutTimers(data: DataRegistry): FestergutTimers {
  const n = (key: string): number => data.num(`festergut.${key}`);
  const pair = (key: string): readonly [number, number] => [n(`${key}_min_ms`), n(`${key}_max_ms`)];
  return {
    berserkMs: n('berserk_ms'),
    inhaleFirst: pair('inhale_first'),
    inhaleRepeatMs: n('inhale_repeat_ms'),
    inhalesBeforePungent: n('inhales_before_pungent'),
    gasSporeFirst: pair('gas_spore_first'),
    gasSporeRepeat: pair('gas_spore_repeat'),
    gasSporeAfterPungent: pair('gas_spore_after_pungent'),
    gasSporeTargets: n('gas_spore_targets'),
    vileGasFirst: pair('vile_gas_first'),
    vileGasRepeat: pair('vile_gas_repeat'),
    vileGasDelayAfterSporeMs: n('vile_gas_delay_after_spore_ms'),
    vileGasMinFarTargets: n('vile_gas_min_far_targets'),
    vileGasFarDistanceYd: n('vile_gas_far_distance_yd'),
    gastricBloatFirst: pair('gastric_bloat_first'),
    gastricBloatRepeat: pair('gastric_bloat_repeat'),
    firstGasDelayMs: n('first_gas_delay_ms'),
  };
}

/** Port of boss_festergutAI (boss_festergut.cpp 89–267), 25-player normal. Heroic Malleable Goo is Gate 4. */
export class FestergutAI extends EventScriptedAI {
  readonly bossId = FESTERGUT_ID;
  readonly mechanics = FESTERGUT_MECHANICS;
  readonly knownServerDifferences: readonly string[] = [
    'Rising-Gods has not been compared yet (Gate 2): every timer and value is the AzerothCore baseline',
  ];
  private inhaleCounter = 0;
  private maxInoculatedStack = 0;
  /** Time left until Professor Putricide arrives and the first Gaseous Blight is applied; null once done. */
  private firstGasInMs: number | null = null;
  private engageEvent: readonly string[] = [];

  constructor(private readonly t: FestergutTimers) {
    super();
  }

  /** boss_festergut.cpp 254–258: only a higher stack is recorded. Called by the Blighted Spores aura script. */
  setData(type: number, value: number): void {
    if (type === DATA_INOCULATED_STACK && value > this.maxInoculatedStack) this.maxInoculatedStack = value;
  }

  /** boss_festergut.cpp 260–266. */
  getData(type: number): number {
    return type === DATA_INOCULATED_STACK ? this.maxInoculatedStack : 0;
  }

  /** JustEngagedWith (boss_festergut.cpp 114–139). The zone-in-combat of line 133 is done by the engine (A-033). */
  protected engage(ctx: BossContext, _who: Unit | null): void {
    const t = this.t;
    this.inhaleCounter = 0;
    this.maxInoculatedStack = 0;
    const ev = ctx.ai('engaged');
    this.engageEvent = [ev];
    this.events.schedule(EVENT_BERSERK, t.berserkMs);
    this.publishWindow(ctx, 'berserk', EVENT_BERSERK, t.berserkMs, t.berserkMs, [ev]);
    this.events.scheduleRange(EVENT_INHALE_BLIGHT, ...t.inhaleFirst);
    this.publishWindow(ctx, 'inhale_blight', EVENT_INHALE_BLIGHT, ...t.inhaleFirst, [ev]);
    this.events.scheduleRange(EVENT_GAS_SPORE, ...t.gasSporeFirst);
    this.publishWindow(ctx, 'gas_spore', EVENT_GAS_SPORE, ...t.gasSporeFirst, [ev]);
    this.events.scheduleRange(EVENT_VILE_GAS, ...t.vileGasFirst, GROUP_VILE_GAS);
    this.publishWindow(ctx, 'vile_gas', EVENT_VILE_GAS, ...t.vileGasFirst, [ev]);
    this.events.scheduleRange(EVENT_GASTRIC_BLOAT, ...t.gastricBloatFirst);
    this.publishWindow(ctx, 'gastric_bloat', EVENT_GASTRIC_BLOAT, ...t.gastricBloatFirst, [ev]);
    // Line 138: Putricide runs to his watch position; on arrival Festergut gets the large Gaseous Blight (A-036).
    this.firstGasInMs = t.firstGasDelayMs;
  }

  override updateAI(ctx: BossContext, diffMs: number): void {
    // Putricide's arrival is his own movement, not an event of Festergut's EventMap: casting does not hold it back.
    if (this.firstGasInMs !== null) {
      this.firstGasInMs -= diffMs;
      if (this.firstGasInMs <= 0) {
        this.firstGasInMs = null;
        const ev = ctx.ai('first_gas', {}, this.engageEvent);
        ctx.cast(GASEOUS_BLIGHT[0], ctx.self.id, [ev], { triggered: true });
      }
    }
    super.updateAI(ctx, diffMs);
  }

  /** The switch of UpdateAI (boss_festergut.cpp 190–249). */
  protected executeEvent(eventId: number, ctx: BossContext): void {
    const t = this.t;
    const self = ctx.self.id;
    switch (eventId) {
      case EVENT_BERSERK: {
        const ev = ctx.ai('berserk');
        ctx.cast('berserk', self, [ev], { triggered: true });
        ctx.clearTimer('berserk', [ev]);
        return;
      }
      case EVENT_INHALE_BLIGHT: {
        const ev = ctx.ai('inhale_blight', { inhales: this.inhaleCounter });
        // RemoveBlight (170–178).
        for (const aura of GASEOUS_BLIGHT) removeAuras(ctx.sim, self, aura, 'removed', [ev]);
        if (this.inhaleCounter === t.inhalesBeforePungent) {
          ctx.cast('pungent_blight', self, [ev]);
          this.inhaleCounter = 0;
          this.events.rescheduleRange(EVENT_GAS_SPORE, ...t.gasSporeAfterPungent);
          this.publishWindow(ctx, 'gas_spore', EVENT_GAS_SPORE, ...t.gasSporeAfterPungent, [ev]);
        } else {
          ctx.cast('inhale_blight', self, [ev]);
          this.inhaleCounter += 1;
          if (this.inhaleCounter < t.inhalesBeforePungent) ctx.cast(GASEOUS_BLIGHT[this.inhaleCounter], self, [ev], { triggered: true });
        }
        this.events.schedule(EVENT_INHALE_BLIGHT, t.inhaleRepeatMs);
        // The next inhale event casts Pungent Blight once the counter is full: the window carries that name.
        const next = this.inhaleCounter === t.inhalesBeforePungent ? 'pungent_blight' : 'inhale_blight';
        this.publishWindow(ctx, next, EVENT_INHALE_BLIGHT, t.inhaleRepeatMs, t.inhaleRepeatMs, [ev]);
        return;
      }
      case EVENT_GAS_SPORE: {
        const ev = ctx.ai('gas_spore');
        // CastCustomSpell with SPELLVALUE_MAX_TARGETS (220).
        ctx.cast('gas_spore', self, [ev], { maxTargets: t.gasSporeTargets, targetStream: `boss:${FESTERGUT_ID}.gas_spore.targets` });
        this.events.scheduleRange(EVENT_GAS_SPORE, ...t.gasSporeRepeat);
        this.publishWindow(ctx, 'gas_spore', EVENT_GAS_SPORE, ...t.gasSporeRepeat, [ev]);
        this.events.delayEventsToMax(t.vileGasDelayAfterSporeMs, GROUP_VILE_GAS);
        this.raiseWindow(ctx, EVENT_VILE_GAS, t.vileGasDelayAfterSporeMs, [ev]);
        return;
      }
      case EVENT_VILE_GAS: {
        // 226–234: prefer a player at least 5 yd away when at least 8 such players exist, else any player (research §5).
        const far = { minDistanceYd: t.vileGasFarDistanceYd, playersOnly: true };
        const farCount = ctx.countTargets(far);
        const target = ctx.selectTarget('vile_gas.targets', farCount >= t.vileGasMinFarTargets ? far : { playersOnly: true });
        const ev = ctx.ai('vile_gas', { farTargets: farCount, target: target?.id ?? null });
        if (target) ctx.cast('vile_gas', target.id, [ev]);
        this.events.scheduleRange(EVENT_VILE_GAS, ...t.vileGasRepeat, GROUP_VILE_GAS);
        this.publishWindow(ctx, 'vile_gas', EVENT_VILE_GAS, ...t.vileGasRepeat, [ev]);
        return;
      }
      case EVENT_GASTRIC_BLOAT: {
        const victim = ctx.victim();
        const ev = ctx.ai('gastric_bloat', { target: victim?.id ?? null });
        if (victim) ctx.cast('gastric_bloat', victim.id, [ev]);
        this.events.scheduleRange(EVENT_GASTRIC_BLOAT, ...t.gastricBloatRepeat);
        this.publishWindow(ctx, 'gastric_bloat', EVENT_GASTRIC_BLOAT, ...t.gastricBloatRepeat, [ev]);
        return;
      }
      default:
        return;
    }
  }
}
```

- [ ] **Step 5: Write `packages/content/src/festergut/boss.ts`:**

```ts
import type { BossModule } from '@raid/engine';
import { FESTERGUT_ID, FestergutAI, festergutTimers } from './ai';
import { FESTERGUT_DATA_25N } from './data';
import { FestergutSpells } from './spell-ids';
import { addFestergutSpells } from './spells';

/** Festergut, Icecrown Citadel, 25-player normal (other difficulties: Gate 4). */
export const festergut: BossModule = {
  id: FESTERGUT_ID,
  data: FESTERGUT_DATA_25N,
  overrides: [],
  setup({ sim, data, difficulty }) {
    if (difficulty !== '25n') throw new Error(`Festergut supports 25n only, not ${difficulty} (other difficulties: Gate 4)`);
    const n = (key: string): number => data.num(`festergut.${key}`);
    sim.addUnit({
      id: FESTERGUT_ID,
      name: 'Festergut',
      kind: 'creature',
      role: 'boss',
      level: n('level'),
      maxHealth: n('health'),
      armor: n('armor'),
      pos: { x: n('spawn_x'), y: n('spawn_y') },
      speedYdPerSec: n('speed_yd_s'),
      combatReach: n('combat_reach_yd') * n('display_scale'),
      boundingRadius: n('bounding_radius_yd') * n('display_scale'),
      melee: { minDamage: n('melee_min'), maxDamage: n('melee_max'), attackTimeMs: n('attack_time_ms') },
    });
    const spells = new FestergutSpells(difficulty);
    addFestergutSpells(sim.catalog, data, spells);
    const ai = new FestergutAI(festergutTimers(data));
    return {
      script: ai,
      bossUnitId: FESTERGUT_ID,
      // The pull: the tank with the lowest id, or the first player when the roster has no tank.
      puller(s) {
        const players = s.players();
        const who = players.find((p) => p.role === 'tank') ?? players[0];
        if (!who) throw new Error('Festergut needs at least one player');
        return who.id;
      },
    };
  },
};
```

- [ ] **Step 6: Register the boss.**

In `packages/content/src/index.ts` replace

```ts
import { trainingDummy } from './training-dummy/boss';
```

with

```ts
import { festergut } from './festergut/boss';
import { trainingDummy } from './training-dummy/boss';
```

In `packages/content/src/index.ts` replace

```ts
  bosses: new Map([[trainingDummy.id, trainingDummy]]),
```

with

```ts
  bosses: new Map([
    [festergut.id, festergut],
    [trainingDummy.id, trainingDummy],
  ]),
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test packages/content/test/festergut/script.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 8: Append to the table in `docs/adaptations.md`:**

```markdown
| A-036 | Festergut's first Gaseous Blight comes a fixed 6788 ms after the engage: Professor Putricide is not a unit; the delay is his 3D distance from spawn to his Festergut watch position (101.82 yd; creature.sql line 138470, boss_professor_putricide.cpp 150) at his charge speed of 15 yd/s (472–474), truncated to whole ms. It is a countdown in the script's AI update, outside the EventMap, so a cast does not hold it back; it fires at the first AI update at or after it (6790 ms with the 10 ms interval). AzerothCore adds the map-update latency of Putricide's arrival and requires Festergut to be in combat then (425–433). | A modelled Putricide would add a unit, movement and an arrival callback for one timer. | `festergut/data.test.ts`, `festergut/script.test.ts` |
| A-037 | Festergut content, 25-player normal only. Engine ids are names that do not depend on the difficulty; the numeric variant is resolved like GetSpellIdForDifficulty when data is read. Left out: the FORCE_CAST gas visuals on NPC 36659 (areas have no creature-entry filter), Gas Spore's DUMMY aura (effect 1, radius 0, no target), Inoculated's PERIODIC_DUMMY (value 0), Vile Gas's LINKED slow and confuse aura 69248, its missile travel time (20 yd/s) and the splash's 1 s root, the quest script of the gas damage, Putricide's talk and visuals, RemoveBlight's dependence on the gas dummy existing. Spell hit and resist are not rolled (Gaseous Blight, Vile Gas and Blighted Spores lack ALWAYS_HIT), and Gastric Explosion cannot crit (A-028). Festergut does not move: his victim must stand in melee range. The boss-mod window of the inhale event is published as `pungent_blight` when that event will cast Pungent Blight. | Each omission is listed in the mechanic statuses of the run (spec §6.4). | `festergut/spells.test.ts`, `festergut/script.test.ts` |
```

- [ ] **Step 9: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/content docs/adaptations.md
git commit -m "feat(content): Festergut boss module and script: engage, first gas, inhale cycle, spores, Vile Gas, Gastric Bloat, berserk

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 7: Pungent Blight's spell script

`spell_festergut_pungent_blight` (`FG` 275–313): per player hit, Inoculated is removed; on the caster, Inhaled Blight is removed. The damage was fixed at launch, so the stacks still reduce the hit that removes them (research §6).

**Files:**
- Create: `packages/content/src/festergut/scripts/pungent-blight.ts`, `packages/content/test/festergut/pungent-blight.test.ts`
- Modify: `packages/content/src/festergut/boss.ts`

**Changed behaviour:** Festergut loses Inhaled Blight at Pungent Blight (before this task the stacks stayed; no test or scenario depended on that).

- [ ] **Step 1: Write the failing test** `packages/content/test/festergut/pungent-blight.test.ts`:

```ts
import { applyAura } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { newFight, type TestPlayer } from './fight';

const between = (v: number, min: number, max: number): boolean => v >= min && v <= max;

/** The tank and three players far apart; `a` gets three Inoculated stacks by hand, `b` one, `c` none. */
const PLAYERS: TestPlayer[] = [
  { id: 't1', role: 'tank', dx: 0, dy: -9.5 },
  { id: 'a', dx: 30, dy: 0 },
  { id: 'b', dx: -30, dy: 0 },
  { id: 'c', dx: 0, dy: 30 },
];

describe('Pungent Blight (boss_festergut.cpp 196–205, 275–313)', () => {
  const f = newFight({ maxDurationMs: 170000, players: PLAYERS });
  // Shortly before the cast ends (25 to 30 s + 102 s + 3 s): fresh stacks, whatever the spores did before.
  f.sim.at(125000, 0, () => {
    for (const [unit, stacks] of [['a', 3], ['b', 1]] as const) {
      const have = [...f.sim.unit(unit).auras.values()].find((x) => x.auraId === 'inoculated')?.stacks ?? 0;
      for (let i = have; i < stacks; i++) applyAura(f.sim, 'inoculated', unit, unit, []);
    }
  });
  f.sim.run();
  const cast = f.events('cast_success', { spell: 'pungent_blight' })[0];
  const hit = (unit: string) => f.events('damage', { ability: 'pungent_blight', target: unit })[0];
  const stacksAtCast = (unit: string): number => {
    const last = [...f.events('aura_applied', { aura: 'inoculated', unit }), ...f.events('aura_stack', { aura: 'inoculated', unit })].filter((e) => e.t < cast.t).sort((x, y) => x.t - y.t).pop();
    return last ? Number(last.data.stacks) : 0;
  };

  it('is cast 3 s after the fourth inhale event and hits every player', () => {
    const start = f.events('cast_start', { spell: 'pungent_blight' })[0];
    expect(cast.t - start.t).toBe(3000);
    expect(f.events('spell_hit', { spell: 'pungent_blight' }).map((e) => e.data.target).sort()).toEqual(['a', 'b', 'c', 'festergut', 't1']);
  });

  it('each Inoculated stack takes a quarter off: the stacks still count for the hit that removes them (A-024)', () => {
    expect(stacksAtCast('a')).toBe(3);
    // 48,750 to 51,250, × 0.25 with three stacks.
    expect(between(Number(hit('a').data.amount), 12187, 12812)).toBe(true);
    const b = stacksAtCast('b');
    expect(b).toBeGreaterThanOrEqual(1);
    expect(between(Number(hit('b').data.amount), Math.trunc(48750 * (1 - 0.25 * b)), Math.trunc(51250 * (1 - 0.25 * b)))).toBe(true);
    const t = stacksAtCast('t1');
    expect(between(Number(hit('t1').data.amount), Math.trunc(48750 * (1 - 0.25 * t)), Math.trunc(51250 * (1 - 0.25 * t)))).toBe(true);
    expect(hit('a').data.school).toBe('shadow');
  });

  it('removes Inoculated from every player it hits, before the damage event', () => {
    for (const unit of ['a', 'b']) {
      const removed = f.events('aura_removed', { aura: 'inoculated', unit }).find((e) => e.t === cast.t);
      expect(removed?.data.reason).toBe('removed');
      expect(Number(removed?.id.slice(1))).toBeLessThan(Number(hit(unit).id.slice(1)));
      expect([...f.sim.unit(unit).auras.values()].some((x) => x.auraId === 'inoculated' && x.appliedMs <= cast.t)).toBe(false);
    }
  });

  it('removes Inhaled Blight from Festergut and brings the large gas back', () => {
    const removed = f.events('aura_removed', { aura: 'inhaled_blight', unit: 'festergut' });
    expect(removed.map((e) => [e.t, e.data.reason])).toEqual([[cast.t, 'removed']]);
    expect(f.events('aura_applied', { aura: 'gaseous_blight_large', unit: 'festergut' }).map((e) => e.t)).toEqual([6790, cast.t]);
    // The next inhale starts the stacks again at one.
    const next = [...f.events('aura_applied', { aura: 'inhaled_blight' })].pop();
    expect(next ? [next.t > cast.t, next.data.stacks] : null).toEqual([true, 1]);
  });

  it('reschedules Gas Spore to 20 to 25 s after the event and publishes that window', () => {
    const start = f.events('cast_start', { spell: 'pungent_blight' })[0];
    const window = f.events('timer_window', { ability: 'gas_spore' }).find((e) => e.t === start.t);
    expect([Number(window?.data.earliestMs) - start.t, Number(window?.data.latestMs) - start.t]).toEqual([20000, 25000]);
    const spore = f.events('cast_start', { spell: 'gas_spore' }).find((e) => e.t > start.t);
    expect(spore && between(spore.t - start.t, 20000, 25010)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/content/test/festergut/pungent-blight.test.ts`
Expected: FAIL in "removes Inoculated from every player it hits" and "removes Inhaled Blight from Festergut" (nothing is removed).

- [ ] **Step 3: Write `packages/content/src/festergut/scripts/pungent-blight.ts`:**

```ts
import type { DataRegistry } from '@raid/data';
import { removeAuras, type SpellScript } from '@raid/engine';
import type { FestergutSpells } from '../spell-ids';

/**
 * spell_festergut_pungent_blight (boss_festergut.cpp 275–313). Effect 0 (the damage), per player hit: Inoculated is
 * removed (HandleHit, 302–306); the hook runs before the damage is dealt, but the damage was fixed at launch, so the
 * stacks still reduce this hit (research §6, A-024). Effect 1 (SCRIPT_EFFECT on the caster): its value names Inhaled
 * Blight, whose difficulty variant is removed from Festergut (HandleScript, 284–300). Putricide's talk and gas visual
 * (297–299) are cosmetic and left out.
 */
export function pungentBlightScript(data: DataRegistry, spells: FestergutSpells): SpellScript {
  // GetEffectValue() of effect 1 is the base Inhaled Blight id; GetSpellIdForDifficulty resolves the variant (291).
  const inhaledBlight = spells.id(spells.num(data, 'pungent_blight', 'e1.min'));
  return {
    onEffectHitTarget(ctx) {
      if (ctx.effectIndex === 0) removeAuras(ctx.sim, ctx.targetId, 'inoculated', 'removed', ctx.causes);
      else if (ctx.effectIndex === 1) removeAuras(ctx.sim, ctx.casterId, inhaledBlight, 'removed', ctx.causes);
    },
  };
}
```

- [ ] **Step 4: Register it.**

In `packages/content/src/festergut/boss.ts` replace

```ts
import { FestergutSpells } from './spell-ids';
```

with

```ts
import { pungentBlightScript } from './scripts/pungent-blight';
import { FestergutSpells } from './spell-ids';
```

In `packages/content/src/festergut/boss.ts`, after

```ts
    const ai = new FestergutAI(festergutTimers(data));
```

add

```ts
    sim.catalog.addSpellScript('pungent_blight', pungentBlightScript(data, spells));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test packages/content/test/festergut`
Expected: PASS; `pungent-blight.test.ts` has 5 tests.

- [ ] **Step 6: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/content
git commit -m "feat(content): Pungent Blight removes Inoculated and Inhaled Blight

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 8: Blighted Spores' aura script: Inoculated (adds A-038)

`spell_festergut_blighted_spores_aura` (`FG` 315–347, research §3 and §8): when Blighted Spores leaves a player, the player casts Inoculated on itself, with the 1 s rule and the 10 s rule, also when the player is dead; the highest stack is reported to the AI (design decisions 5 and 6).

**Files:**
- Create: `packages/content/src/festergut/scripts/blighted-spores.ts`, `packages/content/test/festergut/blighted-spores.test.ts`
- Modify: `packages/content/src/festergut/boss.ts`, `docs/adaptations.md`

**Changed behaviour:** players gain Inoculated from here on.

- [ ] **Step 1: Write the failing test** `packages/content/test/festergut/blighted-spores.test.ts`:

```ts
import { applyAura } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { DATA_INOCULATED_STACK } from '../../src/festergut/ai';
import { newFight, ring, type TestPlayer } from './fight';

const between = (v: number, min: number, max: number): boolean => v >= min && v <= max;

/** The tank and ten players on one spot 30 yd from Festergut: every spore explodes on all ten. */
const GROUP: TestPlayer[] = [{ id: 't1', role: 'tank', dx: 0, dy: -9.5 }, ...Array.from({ length: 10 }, (_, i) => ({ id: `g${String(i + 1).padStart(2, '0')}`, dx: 30, dy: 0 }))];
const GROUP_IDS = GROUP.slice(1).map((p) => p.id);

describe('Gas Spore explosion → Blighted Spores → Inoculated (research §3)', () => {
  const f = newFight({ maxDurationMs: 122000, players: GROUP });
  f.sim.run();
  const spore = f.events('cast_start', { spell: 'gas_spore' })[0].t;
  const carriers = f.events('aura_applied', { aura: 'gas_spore_carrier' }).filter((e) => e.t === spore).map((e) => String(e.data.unit));

  it('each carrier casts Blighted Spores when its 12 s are over; players within 8 yd get the aura, the carrier included', () => {
    const casts = f.events('cast_start', { spell: 'blighted_spores' }).filter((e) => e.t === spore + 12000);
    expect(casts.map((e) => e.data.caster).sort()).toEqual([...carriers].sort());
    expect(casts.every((e) => e.data.triggered === true && e.data.originalCaster === undefined)).toBe(true);
    const groupCarriers = carriers.filter((c) => c !== 't1');
    expect(groupCarriers.length).toBeGreaterThan(0);
    const holders = new Set(f.events('aura_applied', { aura: 'blighted_spores' }).filter((e) => e.t === spore + 12000).map((e) => e.data.unit));
    for (const id of GROUP_IDS) expect(holders.has(id), id).toBe(true);
    // The tank stands 31 yd from the group: only its own spore reaches it.
    expect(holders.has('t1')).toBe(carriers.includes('t1'));
  });

  it('copies of different carriers replace each other, so one aura ticks: 6 ticks of 2925 to 3075', () => {
    const ticks = f.events('damage', { ability: 'blighted_spores', target: 'g01' }).filter((e) => e.t <= spore + 18000);
    expect(ticks.map((e) => e.t - spore)).toEqual([13000, 14000, 15000, 16000, 17000, 18000]);
    expect(ticks.every((e) => e.data.school === 'shadow' && between(Number(e.data.amount), 2925, 3075))).toBe(true);
    const replaced = f.events('aura_removed', { aura: 'blighted_spores', unit: 'g01' }).filter((e) => e.t === spore + 12000);
    expect(replaced.every((e) => e.data.reason === 'replaced')).toBe(true);
  });

  it('when Blighted Spores ends, the player casts Inoculated on itself: one stack per round, whatever the number of spores', () => {
    const gained = f.events('aura_applied', { aura: 'inoculated' }).filter((e) => e.t <= spore + 18000);
    expect(gained.every((e) => e.t === spore + 18000 && e.data.caster === e.data.unit && e.data.expiresMs === spore + 138000)).toBe(true);
    expect(gained.map((e) => e.data.unit).filter((u) => u !== 't1').sort()).toEqual(GROUP_IDS);
    const cast = f.events('cast_start', { spell: 'inoculated', caster: 'g01' })[0];
    expect(cast.data).toMatchObject({ target: 'g01', triggered: true });
    expect(cast.data.originalCaster).toBeUndefined();
  });

  it('three rounds give three stacks, and Festergut records the highest stack', () => {
    const stacks = [...f.events('aura_applied', { aura: 'inoculated', unit: 'g01' }), ...f.events('aura_stack', { aura: 'inoculated', unit: 'g01' })].map((e) => e.data.stacks);
    expect(stacks).toEqual([1, 2, 3]);
    expect(f.ai.getData(DATA_INOCULATED_STACK)).toBe(3);
    // Later ticks are reduced by the stacks the player already has (25 % each).
    const late = f.events('damage', { ability: 'blighted_spores', target: 'g01' }).pop();
    expect(between(Number(late?.data.amount), Math.trunc(2925 * 0.5), Math.trunc(3075 * 0.5))).toBe(true);
  });

  it('a carrier standing alone inoculates only itself', () => {
    const lone = newFight({ maxDurationMs: 45000, players: ring(12, 30) });
    lone.sim.run();
    const who = lone.events('aura_applied', { aura: 'gas_spore_carrier' }).map((e) => e.data.unit).sort();
    expect(lone.events('aura_applied', { aura: 'inoculated' }).map((e) => e.data.unit).sort()).toEqual(who);
    expect(lone.ai.getData(DATA_INOCULATED_STACK)).toBe(1);
  });
});

describe('Blighted Spores: deaths and the two time rules (boss_festergut.cpp 324–341, research §8)', () => {
  it('a carrier that dies before 12 s does not explode', () => {
    const f = newFight({ maxDurationMs: 40000, players: GROUP });
    let victim: string | null = null;
    f.sim.subscribe((e) => {
      if (e.kind !== 'aura_applied' || e.data.aura !== 'gas_spore_carrier' || victim !== null) return;
      victim = String(e.data.unit);
      f.sim.at(f.sim.now + 1000, 0, () => void f.sim.damage(victim!, 1e9, { sourceId: 'festergut', ability: 'test_kill', school: 'physical' }, []));
    });
    f.sim.run();
    expect(victim).not.toBeNull();
    expect(f.events('aura_removed', { aura: 'gas_spore_carrier', unit: victim }).map((e) => e.data.reason)).toEqual(['death']);
    expect(f.events('cast_start', { spell: 'blighted_spores', caster: victim })).toEqual([]);
  });

  it('a player who dies with Blighted Spores still gains Inoculated, and keeps it', () => {
    const f = newFight({ maxDurationMs: 40000, players: GROUP });
    let killed = false;
    f.sim.subscribe((e) => {
      if (e.kind !== 'aura_applied' || e.data.aura !== 'blighted_spores' || e.data.unit !== 'g02' || killed) return;
      killed = true;
      f.sim.at(f.sim.now + 2500, 0, () => void f.sim.damage('g02', 1e9, { sourceId: 'festergut', ability: 'test_kill', school: 'physical' }, []));
    });
    f.sim.run();
    const death = f.events('death', { unit: 'g02' })[0];
    const gained = f.events('aura_applied', { aura: 'inoculated', unit: 'g02' });
    expect(gained.map((e) => e.t)).toEqual([death.t]);
    expect(f.sim.unit('g02').alive).toBe(false);
    expect([...f.sim.unit('g02').auras.values()].map((x) => x.auraId)).toEqual(['inoculated']);
  });

  it('1 s rule: an aura replaced right after it landed gives nothing; 10 s rule: at most one stack per 10 s', () => {
    // Before the first Gas Spore (20 s at the earliest), by hand, on players far apart.
    const f = newFight({ maxDurationMs: 19000, players: ring(4, 30) });
    const spores = (caster: string, target: string) => () => void applyAura(f.sim, 'blighted_spores', caster, target, []);
    f.sim.at(1000, 0, spores('r01', 'r02')); // replaced at once by r03's copy: no stack
    f.sim.at(1000, 0, spores('r03', 'r02')); // ends at 7 s: stack 1
    f.sim.at(8000, 0, spores('r03', 'r02')); // ends at 14 s, 7 s after the last stack: nothing
    f.sim.at(11500, 0, spores('r03', 'r02')); // refreshes it to 17.5 s, 10.5 s after the last stack: stack 2
    f.sim.run();
    const gains = [...f.events('aura_applied', { aura: 'inoculated', unit: 'r02' }), ...f.events('aura_stack', { aura: 'inoculated', unit: 'r02' })];
    expect(gains.map((e) => [e.t, e.data.stacks])).toEqual([
      [7000, 1],
      [17500, 2],
    ]);
    expect(f.events('aura_removed', { aura: 'blighted_spores', unit: 'r02' }).map((e) => [e.t, e.data.reason])).toEqual([
      [1000, 'replaced'],
      [7000, 'expired'],
      [17500, 'expired'],
    ]);
    expect(f.ai.getData(DATA_INOCULATED_STACK)).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/content/test/festergut/blighted-spores.test.ts`
Expected: FAIL in every test that expects Inoculated (no `aura_applied` for `inoculated`); "a carrier that dies before 12 s does not explode" already passes.

- [ ] **Step 3: Write `packages/content/src/festergut/scripts/blighted-spores.ts`:**

```ts
import type { DataRegistry } from '@raid/data';
import { auraKey, startCast, type AuraScript } from '@raid/engine';
import { DATA_INOCULATED_STACK, type FestergutAI } from '../ai';
import type { FestergutSpells } from '../spell-ids';

/**
 * spell_festergut_blighted_spores_aura (boss_festergut.cpp 315–347): when Blighted Spores leaves a player, for any
 * reason and also on a dead player (A-012), the player casts Inoculated on itself, unless
 * - the removed aura was applied less than 1 s ago (327: it is being replaced by another carrier's copy), or
 * - the player's Inoculated was gained or refreshed less than 10 s ago (334: one stack per round of spores).
 * The cast has no original caster (`GetTarget()->CastSpell(GetTarget(), SPELL_INOCULATED, true)`, 337; A-020). The stack
 * the player reaches is reported to Festergut's AI like `festergut->AI()->SetData` (338–340).
 */
export function blightedSporesScript(data: DataRegistry, spells: FestergutSpells, ai: FestergutAI): AuraScript {
  const freshMs = data.num('festergut.blighted_spores_fresh_ms');
  const oncePerMs = data.num('festergut.inoculated_once_per_ms');
  const sporesDurationMs = spells.num(data, 'blighted_spores', 'duration_ms');
  const inoculatedDurationMs = spells.num(data, 'inoculated', 'duration_ms');
  return {
    afterRemove(ctx) {
      const { sim, unitId } = ctx;
      // GetDuration() > GetMaxDuration() - 1000 (327).
      if (ctx.expiresMs !== null && ctx.expiresMs - sim.now > sporesDurationMs - freshMs) return;
      const inoculated = sim.unit(unitId).auras.get(auraKey('inoculated', unitId));
      let stack = 1;
      if (inoculated) {
        stack += inoculated.stacks;
        // GetDuration() > GetMaxDuration() - 10000 (334).
        if (inoculated.expiresMs - sim.now > inoculatedDurationMs - oncePerMs) return;
      }
      const cast = startCast(sim, unitId, 'inoculated', unitId, ctx.causes, { triggered: true });
      if (cast.ok) ai.setData(DATA_INOCULATED_STACK, stack);
    },
  };
}
```

- [ ] **Step 4: Register it.**

In `packages/content/src/festergut/boss.ts` replace

```ts
import { pungentBlightScript } from './scripts/pungent-blight';
```

with

```ts
import { blightedSporesScript } from './scripts/blighted-spores';
import { pungentBlightScript } from './scripts/pungent-blight';
```

In `packages/content/src/festergut/boss.ts`, after

```ts
    sim.catalog.addSpellScript('pungent_blight', pungentBlightScript(data, spells));
```

add

```ts
    sim.catalog.addAuraScript('blighted_spores', blightedSporesScript(data, spells, ai));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test packages/content/test/festergut`
Expected: PASS; `blighted-spores.test.ts` has 8 tests.

- [ ] **Step 6: Append to the table in `docs/adaptations.md`:**

```markdown
| A-038 | Script state reached from spell and aura hooks: hooks only get the simulation, so the Festergut module creates its AI object first and hands it to the script factories; the Blighted Spores aura script calls `ai.setData(DATA_INOCULATED_STACK, stack)` like `festergut->AI()->SetData` (boss_festergut.cpp 254–258, 338–340). `BossContext.setData`/`getData` are per context and not reachable from hooks. The recorded stack is the one the player reaches (old stacks + 1, also beyond the aura's maximum of 3, as in AzerothCore), and it is recorded only when the Inoculated cast started. The achievement that reads it (Flu Shot Shortage) is not evaluated. | One object per run owns the state; no global registry is needed. | `festergut/blighted-spores.test.ts` |
```

- [ ] **Step 7: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/content docs/adaptations.md
git commit -m "feat(content): Blighted Spores grants Inoculated: 1 s and 10 s rules, dead players, highest stack

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 9: Gastric Bloat's spell script: Gastric Explosion

`spell_festergut_gastric_bloat` (`FG` 349–372, research §7): at exactly 10 stacks the aura is removed and the tank casts Gastric Explosion on itself (design decision 5).

**Files:**
- Create: `packages/content/src/festergut/scripts/gastric-bloat.ts`, `packages/content/test/festergut/gastric-explosion.test.ts`
- Modify: `packages/content/src/festergut/boss.ts`

**Changed behaviour:** a tank with ten stacks explodes.

- [ ] **Step 1: Write the failing test** `packages/content/test/festergut/gastric-explosion.test.ts`:

```ts
import { damageDoneFactor } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { newFight, type TestPlayer } from './fight';

const between = (v: number, min: number, max: number): boolean => v >= min && v <= max;

/** The tank, a melee player 6 yd from the tank, one 10.5 yd from the tank, and a ranged player far away. */
const PLAYERS: TestPlayer[] = [
  { id: 't1', role: 'tank', dx: 0, dy: -9.5 },
  { id: 'near', role: 'melee', dx: 6, dy: -9.5 },
  { id: 'edge', role: 'melee', dx: 10.5, dy: -9.5 },
  { id: 'far', dx: 0, dy: -40 },
];

describe('Gastric Bloat at ten stacks: Gastric Explosion (boss_festergut.cpp 349–372, research §7)', () => {
  const f = newFight({ maxDurationMs: 200000, players: PLAYERS });
  let factorAtFive = 0;
  f.sim.subscribe((e) => {
    if (e.kind === 'aura_stack' && e.data.aura === 'gastric_bloat' && e.data.stacks === 5) factorAtFive = damageDoneFactor(f.sim, 't1', 'fire');
  });
  f.sim.run();
  const explosion = f.events('cast_start', { spell: 'gastric_explosion' })[0];

  it('each stack raises the damage of the tank by 10 %', () => {
    expect(factorAtFive).toBeCloseTo(1.5, 10);
  });

  it('the tenth stack removes the aura and makes the tank cast Gastric Explosion on itself', () => {
    const stacks = [...f.events('aura_applied', { aura: 'gastric_bloat' }), ...f.events('aura_stack', { aura: 'gastric_bloat' })].filter((e) => e.t <= explosion.t);
    expect(stacks.map((e) => e.data.stacks)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stacks.every((e) => e.data.unit === 't1')).toBe(true);
    const tenth = stacks[9];
    expect(explosion.t).toBe(tenth.t);
    expect(explosion.data).toMatchObject({ caster: 't1', target: 't1', triggered: true });
    // No original caster: the tank owns the damage (A-020).
    expect(explosion.data.originalCaster).toBeUndefined();
    const removed = f.events('aura_removed', { aura: 'gastric_bloat', unit: 't1' }).find((e) => e.t === explosion.t);
    expect(removed?.data.reason).toBe('removed');
    expect(Number(removed?.id.slice(1))).toBeLessThan(Number(explosion.id.slice(1)));
    // Both come from the Gastric Bloat hit that also added the tenth stack.
    expect(explosion.causes).toEqual(tenth.causes);
  });

  it('hits players within 10 yd of the tank for 29,250 to 30,750, less 25 % per Inoculated stack', () => {
    const hits = f.events('damage', { ability: 'gastric_explosion' }).filter((e) => e.data.target !== 't1');
    expect(hits.map((e) => e.data.target)).toEqual(['near']);
    // The Inoculated stacks of `near` at that moment, read from the trace.
    let stacks = 0;
    for (const e of f.sim.trace.list()) {
      if (e.t > explosion.t) break;
      if (e.data.aura !== 'inoculated' || e.data.unit !== 'near') continue;
      stacks = e.kind === 'aura_removed' ? 0 : Number(e.data.stacks);
    }
    const factor = 1 - 0.25 * stacks;
    expect(hits[0].data).toMatchObject({ source: 't1', school: 'nature+shadow' });
    expect(between(Number(hits[0].data.amount), Math.trunc(29250 * factor), Math.trunc(30750 * factor))).toBe(true);
  });

  it('kills the tank, and Gastric Bloat goes on with the next victim', () => {
    const death = f.events('death', { unit: 't1' })[0];
    expect(death.t).toBe(explosion.t);
    const blow = f.sim.trace.get(death.causes[0]);
    expect(blow?.data).toMatchObject({ ability: 'gastric_explosion', source: 't1', target: 't1' });
    const next = f.events('cast_start', { spell: 'gastric_bloat' }).find((e) => e.t > explosion.t);
    expect(next && next.data.target !== 't1').toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/content/test/festergut/gastric-explosion.test.ts`
Expected: FAIL: the suite cannot read `explosion.t` (no `gastric_explosion` cast exists); only "each stack raises the damage of the tank by 10 %" would pass.

- [ ] **Step 3: Write `packages/content/src/festergut/scripts/gastric-bloat.ts`:**

```ts
import type { DataRegistry } from '@raid/data';
import { removeAuras, startCast, type SpellScript } from '@raid/engine';

/**
 * spell_festergut_gastric_bloat (boss_festergut.cpp 349–372), on effect 2 (SCRIPT_EFFECT): the aura stack of this hit is
 * already applied (research §6). At exactly 10 stacks the aura is removed (364), so its damage bonus does not apply, and
 * the player casts Gastric Explosion on itself, triggered and without an original caster (365; A-020): the player is the
 * damage source, so the creature area-damage avoidance does not apply and the player area cap does (A-026, A-028).
 */
export function gastricBloatScript(data: DataRegistry): SpellScript {
  const explosionStacks = data.num('festergut.gastric_bloat_explosion_stacks');
  return {
    onEffectHitTarget(ctx) {
      if (ctx.effectIndex !== 2) return;
      const { sim, targetId } = ctx;
      // GetAura(id): the aura whoever applied it.
      const bloat = [...sim.unit(targetId).auras.values()].find((a) => a.auraId === 'gastric_bloat');
      if (!bloat || bloat.stacks !== explosionStacks) return;
      removeAuras(sim, targetId, 'gastric_bloat', 'removed', ctx.causes);
      startCast(sim, targetId, 'gastric_explosion', targetId, ctx.causes, { triggered: true });
    },
  };
}
```

- [ ] **Step 4: Register it.**

In `packages/content/src/festergut/boss.ts` replace

```ts
import { blightedSporesScript } from './scripts/blighted-spores';
```

with

```ts
import { blightedSporesScript } from './scripts/blighted-spores';
import { gastricBloatScript } from './scripts/gastric-bloat';
```

In `packages/content/src/festergut/boss.ts`, after

```ts
    sim.catalog.addAuraScript('blighted_spores', blightedSporesScript(data, spells, ai));
```

add

```ts
    sim.catalog.addSpellScript('gastric_bloat', gastricBloatScript(data));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test packages/content/test/festergut`
Expected: PASS; `gastric-explosion.test.ts` has 4 tests. `packages/content/src/festergut/boss.ts` now reads:

```ts
import type { BossModule } from '@raid/engine';
import { FESTERGUT_ID, FestergutAI, festergutTimers } from './ai';
import { FESTERGUT_DATA_25N } from './data';
import { blightedSporesScript } from './scripts/blighted-spores';
import { gastricBloatScript } from './scripts/gastric-bloat';
import { pungentBlightScript } from './scripts/pungent-blight';
import { FestergutSpells } from './spell-ids';
import { addFestergutSpells } from './spells';

/** Festergut, Icecrown Citadel, 25-player normal (other difficulties: Gate 4). */
export const festergut: BossModule = {
  id: FESTERGUT_ID,
  data: FESTERGUT_DATA_25N,
  overrides: [],
  setup({ sim, data, difficulty }) {
    if (difficulty !== '25n') throw new Error(`Festergut supports 25n only, not ${difficulty} (other difficulties: Gate 4)`);
    const n = (key: string): number => data.num(`festergut.${key}`);
    sim.addUnit({
      id: FESTERGUT_ID,
      name: 'Festergut',
      kind: 'creature',
      role: 'boss',
      level: n('level'),
      maxHealth: n('health'),
      armor: n('armor'),
      pos: { x: n('spawn_x'), y: n('spawn_y') },
      speedYdPerSec: n('speed_yd_s'),
      combatReach: n('combat_reach_yd') * n('display_scale'),
      boundingRadius: n('bounding_radius_yd') * n('display_scale'),
      melee: { minDamage: n('melee_min'), maxDamage: n('melee_max'), attackTimeMs: n('attack_time_ms') },
    });
    const spells = new FestergutSpells(difficulty);
    addFestergutSpells(sim.catalog, data, spells);
    const ai = new FestergutAI(festergutTimers(data));
    sim.catalog.addSpellScript('pungent_blight', pungentBlightScript(data, spells));
    sim.catalog.addAuraScript('blighted_spores', blightedSporesScript(data, spells, ai));
    sim.catalog.addSpellScript('gastric_bloat', gastricBloatScript(data));
    return {
      script: ai,
      bossUnitId: FESTERGUT_ID,
      // The pull: the tank with the lowest id, or the first player when the roster has no tank.
      puller(s) {
        const players = s.players();
        const who = players.find((p) => p.role === 'tank') ?? players[0];
        if (!who) throw new Error('Festergut needs at least one player');
        return who.id;
      },
    };
  },
};
```

- [ ] **Step 6: Commit**

Run: `pnpm test && pnpm typecheck && pnpm golden`.

```bash
git add packages/content
git commit -m "feat(content): Gastric Bloat at ten stacks makes the tank cast Gastric Explosion

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

> **Work in progress:** Tasks 10 to 15 (English names, observation checks, the raid plan and the three scenarios, CLI and golden runs, final verification) and the coverage review follow in the next commit.
