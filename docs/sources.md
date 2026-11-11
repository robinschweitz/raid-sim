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

Decided 2026-11-11: **the owner's own WotLK 3.3.5a (build 12340) client** is the source. AzerothCore
loads its spell data from exactly these client files, so the numbers match what the scripts were
written against. A public 3.3.5a database may be used only as a cross-check, never as a source.

- The owner extracts the needed `DBFilesClient\*.dbc` files from the client locally. They are never
  committed (they are Blizzard game data); only the individual values we use go into our data files.
- Each extracted file is pinned by its SHA-256. A version string `client-12340:<file>:<sha256 prefix>`
  goes into `PINS.spellDataVersions`; `spelldata` sources must name one of them.
- AzerothCore's own corrections on top of the client data (`spell_dbc` table, `SpellInfoCorrections.cpp`)
  are applied and sourced separately as `db`/`code`.

`PINS.spellDataVersions` stays empty until the extraction has been done.
