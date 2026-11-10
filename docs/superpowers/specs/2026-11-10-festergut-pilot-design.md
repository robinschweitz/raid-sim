# Raid Explainer — Festergut Pilot: Design

Date: 2026-11-10 (revision 2, after review)
Status: Draft, awaiting owner review

## 1. Purpose

Raid members of the WotLK guild *Bratwurst des Schicksals* (server: Rising-Gods) need one place
that explains their roles, classes, and boss mechanics in depth, beyond text and videos: a fight
can be stepped through event by event, common mistakes and tricks are shown as concrete
scenarios, and later a raid leader can change a raid plan and see what happens.

The existing signup site (`github.com/robinschweitz/raid-website`) stays separate. This project
is a new repository, linked from it.

**The central product promise is explaining fights.** Simulation accuracy serves that promise
and is bounded by an explicit, testable contract (section 6), not by "as accurate as possible".

## 2. Overall vision and decomposition

| Part | Content | Depends on |
| --- | --- | --- |
| Boss encyclopedia | Abilities, phases, timers, positioning, role jobs | Engine boss data |
| Fight replay viewer | 3D arena + timeline, step/scrub, annotated scenarios | Engine trace |
| Strategy simulator | Edit a raid plan, re-run, see the result; optional AI layer later | Engine + plan format |
| Class and role library | Guides per class, spec, and role | Partly on engine data |
| **Shared core** | **Fight engine + boss/class data + raid plan format** | — |

## 3. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Boss and spell behaviour follow **AzerothCore** at a pinned revision (section 5). The port **preserves relevant behaviour with documented adaptations**; it is not a line-by-line translation, because the scripts rely on surrounding core semantics. | Public, maintained reference. |
| D2 | Rising-Gods runs its own, unpublished core. **AzerothCore baseline values and Rising-Gods overrides are stored separately**; an override never replaces the baseline value in the data. | Timings and values may differ; both must stay inspectable. |
| D3 | TypeScript monorepo (pnpm workspaces). Later site: Astro + React islands + React Three Fiber, static, served under the guild's nginx. | Content site with interactive islands; owner knows React; no backend needed. |
| D4 | Engine is pure TypeScript, deterministic, with no UI dependency; runs in Node and in the browser. | One engine for replay, simulator, and tests. |
| D5 | 3D visuals are original: stylized tactical look first, replaceable by a painted art pass per boss later. No extracted or traced Blizzard models, textures, icons, or replica character models. Recognisability comes from camera, familiar UI layout, true-scale geometry, and effect colour language. | Copyright; recognisability. |
| D6 | i18n from day one, English only for now. **Canonical engine output contains IDs and keys only, never translated text.** Readable text is produced by a separate formatter. | Locale must not affect determinism. |
| D7 | Players are actors with real abilities (casts, GCD, resources, cooldowns, procs, priority-list decisions, healer targeting). Each spec has an explicit **support contract** (section 6.2); "fully modelled" is not used. Unmodelled specs run as defined **stand-ins** (section 6.3). | Owner's requirement; a clear finish line per spec. |
| D8 | License GPL-2.0 (AzerothCore is GPL-2.0). | License compatibility. |
| D9 | No game files are shipped. Spell numbers are factual values in data files with versioned sources. Room geometry is our own, modelled from AzerothCore spawn coordinates. | Copyright. |

## 4. Milestones and acceptance gates

Each gate ends with a demonstration to the owner. A gate passes only when its acceptance
criteria hold.

**Gate 1 — Engine slice.** One encounter: Festergut, 25 normal. Modelled specs: Protection
Paladin (tank), Restoration Druid (healer), Fire Mage (DPS). All other raid members are stand-ins,
including the second tank. CLI outputs (section 9). Scenarios: clean kill, player missing a spore
group, late tank swap (section 10).
*Acceptance:* all tests in section 11 pass; each scenario's intended observation is visible in
the event log and summary; the run-level limitation report lists every stand-in and assumption.

**Gate 2 — Validation sample.** The owner provides a few representative Rising-Gods Festergut
logs (25 normal, ideally also 25 heroic). Manual inspection, no importer. Output: a comparison
document listing, per timer, value, and interaction, "agrees / differs (override recorded) /
cannot tell from log", with the log's encounter settings and the uncertainty of each
observation. Differences become Rising-Gods override entries.
*Acceptance:* the comparison document exists and every difference is either an override or a
recorded open question.

**Gate 3 — Minimal viewer.** Enough UI to test teaching value: top-down or simple 3D playback of
the trace with timeline, step, scrub, raid frames, cast bar, and scenario annotations, plus the
"why did this happen" view built from cause references (section 9). Shown to a few raid
members.
*Acceptance:* the owner judges that the scenarios teach what they are meant to teach. Findings
can change the order of the following gates.

**Gate 4 — Encounter coverage.** 10 normal, 10 heroic, 25 heroic (heroic Malleable Goo cast by
Professor Putricide as a separate scripted unit). Scenarios per supported difficulty; a
difficulty is claimed as supported only when its scenarios pass.

**Gate 5 — Spec coverage.** Blood Death Knight, Holy Paladin, Fury Warrior first; then
Discipline Priest, Restoration Shaman, Affliction Warlock, Unholy Death Knight, Marksmanship
Hunter, Combat Rogue. Each spec is added with its support contract.

**Later:** full combat-log importer, Festergut guide page and full 3D site, simulator UI,
further bosses, class library, art pass, AI layer, import of real character stats.

## 5. Source boundary

Pinned before implementation starts and recorded in `docs/sources.md`:

- **AzerothCore core and scripts:** `azerothcore/azerothcore-wotlk` commit
  `dca1a87699e380f3c19af54f9003d837c696131d` (master, 2026-11-10).
- **World database revision:** the SQL in the same commit (`data/sql`), so creature spawns,
  `spell_bonus_data`, and `spell_dbc` overrides match the code.
- **Spell data:** client build 3.3.5a (12340) spell data as the base, with AzerothCore's
  `spell_dbc` and in-code spell corrections applied on top. The exact source used for spell
  fields (local client extraction by the owner or a named public database snapshot) is
  recorded with its version or retrieval date.

Changing any of these is a deliberate change with its own commit; the source tests (section 11)
show which values moved.

### 5.1 Documented core semantics

The port must reproduce these AzerothCore behaviours, each covered by a test:

- The boss's event timers keep advancing while the boss is casting, but no event executes while
  it casts.
- At most one due event executes per AI update.
- Events can be rescheduled and delayed by other events (for example Gas Spore delays Vile Gas;
  Pungent Blight reschedules Gas Spore).
- The AI update interval is configurable; its default is an **assumption** (section 7) until
  Gate 2 gives evidence.

Every deliberate difference from AzerothCore behaviour is listed in `docs/adaptations.md` with
the reason.

## 6. Accuracy contract

### 6.1 Three separate statuses

Every boss mechanic and every spec has three statuses, reported separately:

- **Mechanics:** implemented / partial (omissions listed) / not implemented.
- **Decision policy:** how the actor chooses actions (for players: the priority list and
  targeting rules; for bosses: the script).
- **Validation:** unvalidated / checked against AzerothCore source / checked against Rising-Gods
  logs (with the log reference).

An implemented spec can be unvalidated. Outputs never call something validated that is not.

### 6.2 Spec support contract

Each modelled spec has a file `classes/<spec>/SUPPORT.md` listing:

- Supported build: talents, glyphs, gear profile, set bonuses, enchants, consumables.
- Supported abilities and procs, each with its mechanics status.
- Gear and talent effects that are modelled.
- **Known omissions**, explicitly (for example "trinket procs other than X are not modelled").
- Decision policy: the priority list and, for healers, the targeting rules.
- Validation status per ability.

### 6.3 Stand-ins

A stand-in represents an unmodelled spec. It:

- has health and armor from a profile, occupies a position, follows plan movement with normal
  speed and reaction time, and is subject to the same movement restrictions as modelled players;
- takes damage, can be healed, can die, and is eligible as a target of boss abilities exactly
  like a modelled player of its role;
- deals damage or healing at a configured rate in its role, generates threat from it, and, as a
  tank stand-in, can taunt when a plan rule says so;
- provides its class's raid buffs and debuffs, configured per stand-in;
- does not model resources, cooldowns, or procs;
- is marked `approximate` in the event log, trace, and summary.

### 6.4 Run-level limitation report

Every run reports, in its summary, all stand-ins, all values from `assumption` sources, all
mechanics with status partial, and all differences from Rising-Gods that are known but not
modelled. An approximate healer can decide whether accurately modelled players survive, so
limitations are reported for the run, not only per player.

## 7. Provenance

Every numeric value and every tactical position carries a source:

| Kind | Example | Required fields |
| --- | --- | --- |
| `code` | Festergut script timer | file, commit, line |
| `db` | Spawn coordinate, spell coefficient | table, key, commit |
| `spelldata` | Spell radius, base damage | spell ID, field, data version |
| `log` | Rising-Gods observed timer | log file, encounter settings, uncertainty |
| `derived` | Damage after a formula | formula, inputs (each with their own source) |
| `configured` | Plan position, reaction delay, stand-in rate | file (plan or scenario) |
| `assumption` | Default AI update interval | rationale, what would confirm or replace it |

A value without a source fails validation. Rising-Gods overrides are separate entries with a
`log` source that reference the baseline entry they override.

## 8. Simulation rules

### 8.1 Time and events

Integer milliseconds. Event-driven: a priority queue of scheduled events (cast completions,
spell hits, aura ticks and expiries, melee swings, AI updates, decision wake-ups). Snapshots for
the trace are sampled every 100 ms (configurable), independent of simulation.

### 8.2 Same-timestamp ordering

Events at the same millisecond are processed in this order of classes, then by schedule order
within a class:

1. Cast completions and spell hits (damage and healing), in schedule order.
2. Periodic aura ticks.
3. Aura expiries, including on-expire effects (for example a Gas Spore explosion).
4. AI updates (boss scripts).
5. Player decision wake-ups.

Death is checked immediately after each health change: a unit at 0 health dies at once and
cannot be healed by a later event in the same millisecond. Each rule here is documented as an
adaptation where it is not taken from AzerothCore, and covered by boundary tests.

### 8.3 Movement

Movement is a straight line at constant speed (no pathing; the Festergut room is flat and has no
line-of-sight blockers). A unit's position is computed at the exact time of any event, including
halfway through a move. Range checks use edge-to-edge distance with combat reach and bounding
radius from AzerothCore's creature model data.

### 8.4 Action eligibility

A player re-evaluates its decision policy on: GCD end, cast end or interruption, resource gain
crossing a threshold, cooldown ready, a change to its own auras or a watched unit's auras, and
plan rule triggers. Off-GCD abilities are evaluated at every wake-up. Moving prevents or
interrupts casts that are not usable while moving.

### 8.5 Plan rules

- Each rule has a numeric priority. A higher-priority action pre-empts a running lower-priority
  action; equal priority does not pre-empt.
- Rules are edge-triggered by default (they fire when the condition becomes true), with an
  optional cooldown before they can fire again.
- An action can complete, fail (for example taunt out of range), or be cancelled. Failures are
  logged with the reason. There is no automatic retry unless the rule says so.

### 8.6 Actor knowledge

Actors may use only what a player could see or know: visible casts and cast bars, auras and
health of units, positions, their own state, their plan assignments, and boss-mod style timer
windows (the range in which an ability is due, as an addon would show it). They never inspect
the scheduled time of hidden future events or other actors' random draws.

### 8.7 Randomness

- Seeded PRNG with **separate streams per mechanic and per actor and purpose**, for example
  `festergut.gas_spore.targets`, `festergut.vile_gas.targets`, `player:<id>.crit`,
  `player:<id>.reaction`. Actors have stable IDs defined in the plan, independent of list order.
- **Guarantee:** a mechanic's random selection is unchanged between two runs as long as the
  encounter state relevant to that selection and its eligible target set are equivalent at that
  moment. Movement, deaths, or aura differences that change eligibility may legitimately change
  the selection. Unrelated random draws (for example another player's crits) never shift a
  mechanic's selection.

## 9. Outputs

One run produces:

1. **Canonical trace (JSON, versioned schema):** metadata (engine version, pinned sources,
   seed, scenario, difficulty), every event with a **stable event ID** and **cause references**
   (the event or rule that caused it, for example "Gas Spore explosion ← aura expiry ← Gas Spore
   cast"), and snapshots per sample interval (positions, health, resources, auras, casts).
   Contains IDs and keys only.
2. **Event log (readable):** produced from the trace by the English formatter, for example
   `[00:21.400] Festergut casts Gas Spore → Alice, Bob, Cara`.
3. **Summary:** outcome, duration, deaths with killing blow and the causal chain before it,
   damage and healing per player, maximum stacks, scenario observations (section 10), and the
   limitation report (section 6.4).

**Outcomes:** `kill`, `wipe`, `timeout` (a configured maximum duration is reached), `invalid`
(the input failed validation; nothing is simulated).

CLI: `raid-sim run <boss> --scenario <file> [--seed N] [--difficulty 25n] [--out dir]`.

## 10. Encounter, plans, and scenarios

### 10.1 Festergut (as in the pinned AzerothCore revision)

- **Gaseous Blight:** the room starts with the strongest ambient blight. Each Inhale Blight
  removes the current blight and applies the next weaker variant; at the third inhale no ambient
  blight remains. Raid-wide damage pressure **drops**, while Festergut's Inhaled Blight stacks
  raise his damage, shifting pressure toward the tank.
- **Pungent Blight:** the inhale event after the third inhale casts Pungent Blight, which hits
  the raid, removes Inhaled Blight from Festergut and Inoculated from its targets, and
  reschedules Gas Spore.
- **Gas Spore:** targets 2 players in 10-player and 3 in 25-player modes; its explosion at
  expiry hits nearby players and gives them Inoculated, which reduces Pungent Blight damage.
  Gas Spore delays Vile Gas.
- **Vile Gas** on ranged targets, **Gastric Bloat** on the current victim with Gastric Explosion
  at its stack limit, **boss melee**, **berserk**.
- Heroic: Malleable Goo cast by Professor Putricide (Gate 4).

Timers, thresholds, radii, and damage values live in data with sources (section 7), not in this
document.

### 10.2 Plan format

YAML checked against a schema (zod); an invalid file yields outcome `invalid` with file, path,
and problem.

- **Roster:** stable ID, name, class/spec (or stand-in), profile reference, reaction time range.
- **Spots:** named positions in yards in the boss room's coordinate system.
- **Assignments** per phase.
- **Rules:** a small fixed vocabulary of triggers (`aura_applied`, `aura_stacks`, `cast_start`,
  `time`, `health_below`, …) and actions (`move_to`, `taunt`, `use_cooldown`, `stop_casting`, …),
  with priority, trigger mode, and retry as in section 8.5. Behaviour that does not fit is written
  in TypeScript in the boss package; the vocabulary is not extended into a general language.

### 10.3 Scenarios

A scenario is: plan + difficulty + seed + mistakes + **intended observation** + annotations.
The intended observation states what the scenario must show, and need not be a wipe. Gate 1
scenarios:

| Scenario | Mistake | Intended observation |
| --- | --- | --- |
| Clean kill | none | Kill before berserk; every spore group member gains Inoculated stacks; tank swaps before Gastric Explosion. |
| Missed spore group | one ranged player does not join a spore group | That player has fewer Inoculated stacks than their group and takes more damage from the next Pungent Blight than inoculated players. |
| Late tank swap | tank-swap rule threshold set too high | The current tank reaches the Gastric Bloat stack limit and Gastric Explosion occurs; the cause chain links it to the rule threshold. |

Each observation is checked automatically by the scenario test (section 11).

## 11. Testing

- **Worked examples:** expected values calculated by hand, independently of the
  implementation and stored with the calculation (for example a Fireball's damage range from
  coefficient and spell power, armor mitigation of one boss swing). Source tags and golden
  outputs alone can preserve an implementation mistake; worked examples guard against that.
- **Boundary tests:** a player exactly at, just inside, and just outside the Gas Spore radius;
  simultaneous aura expiry and damage at the same millisecond; a cast interrupted by movement;
  a tank swap with taunt, threat transfer, and the next Gastric Bloat landing on the new tank;
  boss event due while casting; two events due in the same AI update.
- **Core semantics tests** for every point in section 5.1.
- **Determinism tests:** same scenario and seed give byte-identical canonical traces; the
  randomness guarantee of section 8.7 holds, including a case where movement legitimately
  changes eligibility.
- **Locale test:** changing the formatter's locale does not change the canonical trace.
- **Scenario tests:** each scenario's intended observation holds.
- **Golden runs:** stored canonical traces of all scenarios; a change fails until it is reviewed
  and accepted.

## 12. Repository layout

```
packages/
  engine/              core simulation; no boss- or class-specific logic
  data/                spell, aura, and creature data with provenance; overrides kept separate
  classes/<spec>/      abilities, build, priority list, SUPPORT.md
  bosses/festergut/    Festergut (and later Putricide) data and script
  format/              locale formatters (English) for event log and summary
  cli/                 scenario runner
scenarios/festergut/   YAML plans and scenarios
docs/                  specs, sources.md, adaptations.md, validation notes
```

`engine` does not import from `classes`, `bosses`, `format`, or `cli`.

## 13. Out of scope for Gate 1

UI, other difficulties, specs beyond the three Gate 1 specs, any log importer, simulator UI,
AI layer, art, German text.

## 14. Open points

- What "a model like jev" in the owner's simulator idea refers to; to clarify before the AI layer
  is designed.
- Whether real character stats are imported from the signup site's Rising-Gods data.
- Hosting path (`/guide` on the existing domain or a subdomain).
- Which spell-data source the owner can provide (local client extraction or a public database
  snapshot); needed before Gate 1 implementation begins.
