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
