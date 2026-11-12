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
| `src/server/shared/DataStores/DBCfmt.h` lines 108–117 | DBC column formats (`packages/data/src/dbc/spell.ts`) |
| `src/server/shared/DataStores/DBCStructure.h` `struct SpellEntry` (line 1677) | Spell DBC column names and order |
| `src/server/game/Combat/ThreatManager.cpp`, `ThreatManager.h` line 94 | Victim selection, taunt, healing threat, 1 s threat update (`threat.ts`) |
| `src/server/game/Entities/Unit/Unit.cpp` lines 807–811, 2233–2300, 8204, 13306 | Melee range, armor reduction, healing threat, attack-power multiplier |
| `src/server/game/Entities/Unit/StatSystem.cpp` line 1117 | Creature melee damage (`melee.ts`) |
| `src/server/game/Entities/Creature/Creature.cpp` line 1554, `CreatureData.h` lines 313–335 | Creature base damage, health, armor |
| `data/sql/base/db_world/creature_template.sql`, `creature_classlevelstats.sql`, `creature_model_info.sql`, `creature_template_model.sql`, `creature.sql` | Festergut stats, size and spawn (Plan 2b) |
| `src/server/game/Spells/Spell.cpp` lines 1002–1011, 1414–1419, 2161, 2885–2957, 3253, 3336–3354, 4031–4177, 5866–5871, 8619–8745, 9504–9521 | Area targets, shared target lists, max targets, launch and hit order, area damage reduction, player area cap (`area.ts`, `launch.ts`) |
| `src/server/game/Spells/SpellEffects.cpp` lines 279–292, 330–333, 808–812, 1043–1098 | Instakill, school damage at launch, trigger spell, force cast (`launch.ts`, `effects.ts`) |
| `src/server/game/Spells/Auras/SpellAuraEffects.cpp` lines 557–580, 755–804, 926–950, 4830–4858, 6252, 6398–6405 | Aura amounts × stacks, remove hooks for every mode, periodic tick before expiry, attack speed, periodic trigger, periodic area reduction (`auras.ts`, `stats.ts`) |
| `src/server/game/Spells/Auras/SpellAuras.cpp` lines 2131–2151, 2193–2210 | Area auras of different casters replace each other (`auras.ts`) |
| `src/server/game/Spells/SpellInfo.cpp` lines 409–447, 554–557, 1262, 1655–1674 | Effect value from basePoints and dieSides, radius 0, death-persistent auras, ignoring caster modifiers (`spelldata/entries.ts`, `catalog.ts`) |
| `src/server/game/Spells/SpellMgr.cpp` lines 538–578 | Difficulty variants with the heroic fallback (`spelldata/variants.ts`) |
| `src/server/game/Entities/Unit/Unit.cpp` lines 774–788, 5424–5443, 6026–6050, 6116–6124, 8896–8897, 12829–12835, 13135–13152, 16030–16036 | Combat range, death removal, damage-done percentages, school-mask overlap, no creature crits, scale, attack time, area damage reduction |
| `src/server/game/Entities/Creature/Creature.cpp` lines 2893–2937, 3591–3607 | Engagement start, combat reach from scale |
| `src/server/game/AI/CoreAI/UnitAI.h` lines 53–100, 238–262, 282–343 | SelectTarget distance rules and target lists (`boss.ts`) |
| `src/server/game/AI/ScriptedCreature.cpp` lines 681–685 | BossAI::_JustEngagedWith calls DoZoneInCombat first (`engage.ts`) |
| `src/server/game/AI/CreatureAI.h` line 131 | JustStartedThreateningMe starts the engagement |
| `src/server/game/AI/CreatureAI.cpp` lines 117–165, 286–296 | DoZoneInCombat and EngagementStart (`engage.ts`) |
| `src/server/game/Combat/ThreatManager.cpp` lines 484–524, 650–729 | The first threat reference becomes the victim and starts the engage chain (`engage.ts`) |
| `src/server/shared/SharedDefines.h` lines 288–290, 374–635, 767–906, 1414–1495; `src/server/game/Spells/Auras/SpellAuraDefines.h` lines 66–347 | School masks, attributes, effect, target and aura ids |
| `src/common/Utilities/EventMap.cpp` lines 200–212 | GetTimeUntilEvent, HasTimeUntilEvent (`eventmap.ts`, timer windows in `boss.ts`) |
| `src/server/scripts/Northrend/IcecrownCitadel/boss_festergut.cpp` lines 48–66, 114–139, 170–267, 275–372 | Festergut's spells, engage schedule, event switch, SetData, spell and aura scripts (`packages/content/src/festergut/`) |
| `src/server/scripts/Northrend/IcecrownCitadel/boss_professor_putricide.cpp` lines 150–152, 425–433, 472–474 | Putricide's run to his Festergut watch position and the first Gaseous Blight (`festergut/data.ts`, `ai.ts`) |
| `src/server/scripts/Northrend/IcecrownCitadel/icecrown_citadel.h` lines 48, 266–267, 276, 552–554 | Berserk 47008, creature entries, Festergut actions |
| `src/server/game/Globals/ObjectMgr.cpp` lines 1133–1134; `src/server/game/Entities/Unit/Unit.h` line 43 | A BaseAttackTime of 0 becomes BASE_ATTACK_TIME (2000 ms) |
| `src/server/game/Entities/Creature/Creature.cpp` line 563 | Creature run speed from `speed_run` |
| `src/server/shared/SharedDefines.h` lines 393, 426, 444, 489, 499, 501, 621 | Attribute bits read from the spell data (`festergut/spells.ts`) |
| `data/sql/base/db_world/creature_template.sql` lines 28379, 28891; `creature_classlevelstats.sql` line 381; `creature_template_model.sql` line 38525; `creature_model_info.sql` line 23955; `creature.sql` lines 138459, 138470 | Festergut 25n creature values, model size, spawn; Putricide's spawn (`festergut/data.ts`) |

## Spell data

Decided 2026-11-11: **the owner's own WotLK 3.3.5a (build 12340) client** is the source. AzerothCore
loads its spell data from exactly these client files, so the numbers match what the scripts were
written against. A public 3.3.5a database may be used only as a cross-check, never as a source.

- The owner extracts the needed `DBFilesClient\*.dbc` files from the client locally. They are never
  committed (they are Blizzard game data); only the individual values we use go into our data files.
- Each extracted file is pinned by its SHA-256. A version string `client-12340:<file>:<sha256 prefix>`
  goes into `PINS.spellDataVersions`; `spelldata` sources must name one of them.
- AzerothCore's own corrections on top of the client data (`spell_dbc` table, `SpellInfoCorrections.cpp`)
  are applied and sourced separately as `db`/`code`.

Extracted 2026-11-11 with `pnpm extract-spells` from the owner's client (folder `WoW_3.3.5a_rising-gods.de`,
locale deDE), read straight from the MPQ archives; the output is `packages/content/data/spelldata/festergut.json`.
Pinned files (version string, full SHA-256, source archive relative to the client folder):

| File | Version (`PINS.spellDataVersions`) | SHA-256 | Source archive |
|---|---|---|---|
| Spell.dbc | `client-12340:Spell.dbc:a17bfd2d4b0a` | `a17bfd2d4b0ac0dbf8263371c771651e783f123329995d0ae609a08bc05a8bf7` | `Data/deDE/patch-deDE-3.MPQ` |
| SpellCastTimes.dbc | `client-12340:SpellCastTimes.dbc:919ca9b65cb1` | `919ca9b65cb144a3a9cf0ce10d2a25fcc7cdccf33c752ed376e086ff62f8ccec` | `Data/deDE/patch-deDE-2.MPQ` |
| SpellDifficulty.dbc | `client-12340:SpellDifficulty.dbc:9173f9a8c97e` | `9173f9a8c97e690fb5a7ce1d6730c1449da214752c52a3885f79d58952bb95a4` | `Data/deDE/patch-deDE-3.MPQ` |
| SpellDuration.dbc | `client-12340:SpellDuration.dbc:caa2cbec7fa7` | `caa2cbec7fa711bba180af10c253ab0d111609ec2bda1c354fef09e54bc279e4` | `Data/deDE/patch-deDE-3.MPQ` |
| SpellRadius.dbc | `client-12340:SpellRadius.dbc:409b1612d19b` | `409b1612d19bb7860de2a2ea0f18669be1cf40477f85f5c6e12c4758277f3475` | `Data/deDE/patch-deDE.MPQ` |
| SpellRange.dbc | `client-12340:SpellRange.dbc:dec6105c88d1` | `dec6105c88d166377a96f8b1c0af7864849c6727c60ba5b481f0f03be15d4e6c` | `Data/deDE/patch-deDE-3.MPQ` |

SpellDifficulty.dbc is pinned and read, but its rows are not registry entries: the loader consumes them through `SpellVariants` (`packages/content/src/spelldata/variants.ts`), which resolves a spell id to its 10n / 25n / 10h / 25h variant with the heroic fallback, so no `spell.<id>.*` key carries a SpellDifficulty provenance.
