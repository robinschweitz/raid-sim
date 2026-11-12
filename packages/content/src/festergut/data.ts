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
