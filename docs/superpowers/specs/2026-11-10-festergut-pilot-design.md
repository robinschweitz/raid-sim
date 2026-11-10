# Raid Explainer — Festergut Pilot: Design

Date: 2026-11-10
Status: Draft, awaiting owner review

## 1. Purpose

Raid members of the WotLK guild *Bratwurst des Schicksals* (server: Rising-Gods) need one place
that explains their roles, classes, and boss mechanics in depth, beyond text and videos: a fight
can be stepped through event by event, common mistakes and tricks are shown as concrete
scenarios, and later a raid leader can change a raid plan and see what happens.

The existing signup site (`github.com/robinschweitz/raid-website`) stays separate. This project
is a new repository, linked from it.

## 2. Overall vision and decomposition

The full product has four parts that share one core:

| Part | Content | Depends on |
| --- | --- | --- |
| Class and role library | Guides per class, spec, and role | Partly on engine data |
| Boss encyclopedia | Abilities, phases, timers, positioning, role jobs | Engine boss data |
| Fight replay viewer | 3D arena + timeline, step/scrub, annotated scenarios | Engine trace output |
| Strategy simulator | Edit a raid plan, re-run, see the result; optional AI layer later | Engine + plan format |
| **Shared core** | **Fight engine + boss/class data + raid plan format** | — |

Build order: shared core with one boss (Festergut) → output proven on the command line →
Festergut page and 3D viewer → more bosses and specs → simulator UI → class library alongside.

**This spec covers Milestone 1 (engine + CLI) in detail and fixes the decisions that later
milestones must respect.**

## 3. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Boss mechanics and class spell behaviour are ported by hand from **AzerothCore** (pinned commit). | Owner's choice; public, maintained, closest available reference to the server. |
| D2 | Rising-Gods runs its own core, which is not published. AzerothCore values are the starting point; a later milestone checks them against Rising-Gods combat logs. | Timings may differ from AzerothCore. |
| D3 | Separate project: **TypeScript monorepo (pnpm workspaces)**. Later site: **Astro + React islands + React Three Fiber (Three.js)**, static, served under the guild's nginx. | Content-heavy static site with interactive islands; owner already uses React; no backend needed. |
| D4 | **Engine is pure TypeScript, deterministic, and has no UI dependency.** It runs in Node (CLI, tests) and later in the browser. | One engine for replay, simulator, and tests. |
| D5 | **3D visuals are original**: a stylized tactical look first, built so a painted art pass can replace any boss's look later (owner choice "C"). No extracted or traced Blizzard models, textures, icons, or replica character models. Recognisability comes from a WoW-like camera, familiar UI layout (raid frames, cast bar, timer bars), true-scale geometry, and the colour language of effects. | Copyright; owner wants players to recognise the fight. |
| D6 | **i18n from day one, English only for now.** Every user-facing string, ability name, and guide text has a locale key; routes are `/en/...`. The owner adds German later. | Owner's choice. |
| D7 | **Players are modelled as real actors with real abilities** (casts, GCD, resources, cooldowns, procs, priority-list decisions, healer targeting), not as damage/heal rates. Specs that are not yet modelled run on a stand-in that is labelled "approximate" in every output. | Owner's requirement; honesty about accuracy. |
| D8 | License: **GPL-2.0**, because boss and spell logic is ported from AzerothCore (GPL-2.0). | License compatibility. |
| D9 | No game files are shipped. Spell numbers are factual values entered into data files with their source. Room geometry is our own, modelled from AzerothCore spawn coordinates. | Copyright. |

## 4. Milestones

**Milestone 1 — Engine + CLI (this spec, detailed below).**
Festergut on all four difficulties; heroic Putricide as a scripted off-arena unit; six specs fully
modelled: Protection Paladin and Blood Death Knight (tanks), Restoration Druid and Holy Paladin
(healers), Fire Mage and Fury Warrior (DPS). All other specs use the labelled stand-in.
Scenarios are written for 25-player normal and heroic. Output: event log, JSON trace, summary.
No UI.

**Milestone 2 — More specs.** Discipline Priest, Restoration Shaman, Affliction Warlock, Unholy
Death Knight, Marksmanship Hunter, Combat Rogue.

**Milestone 3 — Site and viewer.** Astro site with i18n, Festergut guide page reading ability
data from the engine, 3D replay viewer reading the JSON trace (orbit camera, play/pause, step,
scrub, speed, follow player, raid frames, cast bar, timer bars, debuffs, scenario annotations).

**Milestone 4 — Validation against Rising-Gods logs.** Import combat logs, compare observed
timers and values with the engine, and record measured values with source "measured from log".

**Later:** simulator UI (editing plans), further bosses, class library, art pass, AI layer,
import of real character stats from the signup site's Rising-Gods data.

## 5. Milestone 1 design

### 5.1 Repository layout

```
packages/
  engine/              core simulation, no boss- or class-specific logic
  data/                shared spell/aura/creature data with sources
  classes/<spec>/      one package or folder per modelled spec (abilities, build, priority list)
  bosses/festergut/    Festergut + Putricide (heroic) data and script
  cli/                 scenario runner
scenarios/festergut/   YAML raid plans and scenarios
docs/                  specs, decisions, source notes
```

`engine` must not import from `classes`, `bosses`, or `cli`. Bosses and classes register
themselves with the engine through its public interfaces.

### 5.2 Simulation core

- **Time:** integer milliseconds. **Event-driven**: a priority queue of scheduled events
  (cast finishes, aura ticks, swings, movement arrivals, AI updates). Ties are ordered by
  schedule order, so runs are reproducible.
- **Boss AI update:** the boss script runs on a periodic AI update (interval configurable), like
  AzerothCore's `UpdateAI(diff)`, so its timer behaviour matches the server's.
- **Sampling:** independent of simulation, a snapshot of all units is written every 100 ms
  (configurable) for the trace. Every individual event is also written.
- **Random numbers:** a seeded PRNG with **separate named streams** (boss targeting, each
  player's combat rolls, each player's reaction delays, and so on). A change to one player's
  behaviour must not change boss target selection. Test: running a scenario with a mistake
  applied to player X yields the same boss target sequence as the clean run, until the point
  where the outcome itself legitimately differs (for example a death changes who is eligible).

### 5.3 Model

- **Unit:** health, resources, position (yards, 2D plus facing; the Festergut room is flat and
  has no line-of-sight blockers), movement speed, combat reach / bounding radius, auras, threat
  table (for creatures), current cast, cooldowns, stats.
- **Spell:** cast time, GCD, cost, range (edge to edge, using combat reach), target selection,
  travel time, hit/crit rolls, effects (school damage, heal, apply aura, trigger spell, taunt),
  coefficients.
- **Aura:** duration, stacks, periodic tick interval and effect, stat or damage modifiers,
  on-expire effects (for example Gas Spore exploding).
- **Combat rules:** armor mitigation; dodge, parry, block, and miss for melee; spell hit and crit;
  boss melee swings with a swing timer; threat with modifiers and taunt.
- **EventMap and BossAI:** a counterpart of AzerothCore's `EventMap` (schedule with min/max
  delay, cancel, phases) and the boss script hooks (engage, update, damage taken, death), so
  the port follows the C++ structure line by line.

### 5.4 Festergut content

Ported from `boss_festergut.cpp` and related ICC scripts at the pinned commit: Gas Spore (and
the Inoculated stacks it gives to nearby players), Inhale Blight and the increasing Gaseous
Blight raid damage, Pungent Blight, Gastric Bloat and Gastric Explosion, Vile Gas, boss melee,
berserk. Heroic: Malleable Goo, cast by Professor Putricide as a separate scripted unit outside
the arena. All four difficulties are supported through difficulty-dependent values. Spawn
positions come from AzerothCore's world database.

Every numeric value is stored with a source tag:
`{ value, source: "<file>@<commit>:L<line>" | "spell:<id>.<field>" | "log:<file>" }`.
A value without a source fails validation.

### 5.5 Players

- **Profile per player:** class, spec, race, level-80 stats from a gear profile, one standard
  talent and glyph build per spec, set bonuses (for example T10), consumables on/off.
- **Raid buffs and debuffs** come from the players in the roster (no shaman, no totems).
- **Decisions:** a priority list per spec, evaluated whenever the player is free to act
  (GCD and cast finished). Movement ordered by the raid plan interrupts or prevents casts the way
  the game does.
- **Healer targeting:** range, health deficit, priority targets (tanks, spore carriers),
  incoming effects; overhealing is recorded.
- **Reaction time:** per player, a delay range (for example 300–600 ms) before reacting to a
  trigger, drawn from that player's own random stream.
- **Stand-in:** unmodelled specs perform their role through a simple throughput model and are
  marked `approximate: true` in the event log, trace, and summary.

### 5.6 Raid plan and scenario format

YAML files checked against a schema (zod). An invalid file stops the run with a message that
names the file, path, and problem.

- **Roster:** name, class/spec, profile reference, reaction time.
- **Spots:** named positions in yards in the boss room's coordinate system.
- **Phases and assignments:** who stands where, per phase.
- **Rules:** a small fixed vocabulary of triggers (`aura_applied`, `aura_stacks`, `cast_start`,
  `time`, `health_below`, …) and actions (`move_to`, `taunt`, `use_cooldown`, `stop_casting`, …).
  Anything that does not fit this vocabulary is written in TypeScript as part of the boss
  package; the vocabulary is not extended into a general language.
- **Scenario:** plan reference + difficulty + seed + mistakes + annotations. Mistakes are
  overrides (`disable_rule: tank_swap`, `player: Cara, ignore: spore_group`,
  `player: X, reaction_ms: 1500`). Annotations are text keyed to time or event, used later by the
  viewer.

Milestone 1 scenarios: clean kill (25 normal, 25 heroic), player not in a spore group, late tank
swap, no healing cooldowns on a late Pungent Blight.

### 5.7 Outputs

One run produces:

1. **Event log** (readable, combat-log style), e.g.
   `[00:21.400] Festergut casts Gas Spore → Alice, Bob, Cara`.
2. **JSON trace:** metadata (engine version, AzerothCore commit, seed, scenario), all events,
   and snapshots every sample interval (positions, health, resources, auras, casts). This is
   the input the viewer will use; its schema is versioned.
3. **Summary:** kill or wipe, duration, deaths with killing blow and preceding events, damage
   and healing per player, maximum stacks, list of approximate players.

CLI: `raid-sim run <boss> --scenario <file> [--seed N] [--difficulty 25h] [--out dir]`.

### 5.8 Testing

- Vitest. Unit tests for the core (event ordering, aura ticks, combat rolls, threat).
- **Source tests:** each Festergut timer, threshold, and radius has a test that cites the same
  source as the data value.
- **Spec tests:** each modelled spec's rotation is checked against known behaviour (for example
  Fire Mage uses Pyroblast only with Hot Streak; Resto Druid keeps Lifebloom stacked on the
  tank).
- **Determinism tests:** same scenario and seed give byte-identical output; separate random
  streams hold as described in 5.2.
- **Golden runs:** the Milestone 1 scenarios are stored as expected outputs; a change in
  output fails until it is reviewed and accepted.

## 6. Out of scope for Milestone 1

UI and site, 3D, other bosses, the six Milestone 2 specs, combat-log validation, simulator UI,
AI layer, art, German text.

## 7. Open points for later milestones

- What "a model like jev" in the owner's simulator idea refers to; to clarify before the AI layer
  is designed.
- Whether real character stats are imported from the signup site's Rising-Gods data.
- Hosting path (`/guide` on the existing domain or a subdomain).
