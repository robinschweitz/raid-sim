import { PINS } from '@raid/data';

const commit = PINS.azerothcoreCommit;

/** Engine constants with provenance (§7). Validated by DataRegistry like every other value. */
const standin = (key: string, value: number, what: string): Record<string, unknown> => ({
  key,
  value,
  source: {
    kind: 'assumption',
    rationale: `${what}; stand-ins are approximations (A-011)`,
    confirmBy: 'replaced when the spec is modelled (Plan 3)',
  },
});

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
    source: {
      kind: 'assumption',
      rationale: 'Viewer stepping resolution chosen in the design spec (section 8.1); it does not model anything on the server',
      confirmBy: 'Gate 3: viewer review',
    },
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
  standin('core.standin_tick_ms', 1000, 'Stand-ins deal damage or healing once per second'),
  standin('core.standin_range_tank_yd', 5, 'A tank stand-in hits the boss from melee range'),
  standin('core.standin_range_melee_yd', 5, 'A melee stand-in hits the boss from melee range'),
  standin('core.standin_range_ranged_yd', 40, 'A ranged stand-in hits the boss from up to 40 yd'),
  standin('core.standin_range_healer_yd', 40, 'A healer stand-in heals players up to 40 yd away'),
];
