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
