const configured = { kind: 'configured', file: 'packages/content/src/training-dummy/data.ts' } as const;

/** Training dummy values: invented for demos, not taken from the game. */
export const TRAINING_DUMMY_DATA: readonly unknown[] = [
  ['training_dummy.health', 150000],
  ['training_dummy.combat_reach_yd', 5],
  ['training_dummy.melee_min', 3000],
  ['training_dummy.melee_max', 4000],
  ['training_dummy.attack_time_ms', 2000],
  ['training_dummy.mark_interval_ms', 12000],
  ['training_dummy.mark_range_yd', 30],
  ['training_dummy.mark_duration_ms', 3000],
  ['training_dummy.level', 83],
  ['training_dummy.bounding_radius_yd', 1],
  ['training_dummy.speed_yd_s', 0],
].map(([key, value]) => ({ key, value, source: configured }));
