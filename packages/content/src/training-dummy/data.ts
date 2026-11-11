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
  ['training_caster.health', 20000],
  ['training_caster.bolt_min', 1000],
  ['training_caster.bolt_max', 1200],
  ['training_caster.bolt_cast_ms', 1500],
  ['training_caster.bolt_range_yd', 40],
].map(([key, value]) => ({ key, value, source: configured }));
