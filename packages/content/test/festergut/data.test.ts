import { DataRegistry, PINS } from '@raid/data';
import { CORE_DATA, creatureMeleeDamage } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { FESTERGUT_DATA_25N, festergutData } from '../../src/festergut/data';
import { FestergutSpells } from '../../src/festergut/spell-ids';

const data = new DataRegistry([...CORE_DATA, ...FESTERGUT_DATA_25N]);
const source = (key: string) => data.baselineOf(key).source;

describe('Festergut data, 25-player normal', () => {
  it('worked example: health and armor from the class level stats and the template modifiers', () => {
    // basehp2 13945 × HealthModifier 2900 = 40,440,500; basearmor 10643 × ArmorModifier 1 = 10,643.
    expect(data.num('festergut.health')).toBe(40440500);
    expect(data.num('festergut.armor')).toBe(10643);
    expect(data.num('festergut.level')).toBe(83);
  });

  it('worked example: melee damage before armor', () => {
    // Attack power part: 805 / 14 × 1 = 57.5. Multiplier: DamageModifier 122.6 × attack time 2000 / 1000 = 245.2.
    // min = (177.074 + 57.5) × 245.2 = 57,517.54 → 57,517; max = (1.5 × 177.074 + 57.5) × 245.2 = 79,226.82 → 79,226.
    expect(data.num('festergut.melee_min')).toBe(57517);
    expect(data.num('festergut.melee_max')).toBe(79226);
  });

  it('the attack time is the core default because the database stores 0', () => {
    expect(data.num('festergut.base_attack_time_db')).toBe(0);
    expect(data.num('festergut.attack_time_ms')).toBe(2000);
    expect(source('festergut.default_attack_time_ms')).toEqual({ kind: 'code', file: 'src/server/game/Entities/Unit/Unit.h', commit: PINS.azerothcoreCommit, line: 43 });
  });

  it('worked example: the first gas comes when Putricide has run 101.82 yd at 15 yd/s', () => {
    // dx = 4356.19 − 4324.82 = 31.37, dy = 3262.90 − 3166.03 = 96.87, dz = 389.482 − 389.3831 = 0.0989.
    // sqrt(31.37² + 96.87² + 0.0989²) = 101.8228 yd; / 15 yd/s = 6.78819 s → 6788 ms.
    expect(data.num('festergut.first_gas_delay_ms')).toBe(6788);
    expect(source('festergut.first_gas_delay_ms').kind).toBe('derived');
  });

  it('database values name their table, row, column and SQL line; script values their line', () => {
    expect(source('festergut.health_modifier')).toEqual({
      kind: 'db',
      table: 'creature_template',
      key: 'entry 37504, column HealthModifier (data/sql/base/db_world/creature_template.sql line 28891)',
      commit: PINS.azerothcoreCommit,
    });
    expect(source('festergut.combat_reach_yd')).toMatchObject({ kind: 'db', table: 'creature_model_info' });
    expect(data.num('festergut.combat_reach_yd')).toBe(8);
    expect(source('festergut.inhale_repeat_ms')).toEqual({
      kind: 'code',
      file: 'src/server/scripts/Northrend/IcecrownCitadel/boss_festergut.cpp',
      commit: PINS.azerothcoreCommit,
      line: 215,
    });
    expect(data.num('festergut.gas_spore_targets')).toBe(3);
    expect(data.num('festergut.vile_gas_min_far_targets')).toBe(8);
  });

  it('holds every spell field of the 25n variants with a spelldata source', () => {
    const spells = new FestergutSpells('25n');
    expect(spells.variantIds()).toEqual([47008, 69157, 69162, 69164, 69165, 69279, 70135, 70138, 70468, 71218, 71219, 71221, 71222, 71288, 71912, 72101, 72228, 72551]);
    expect(data.num(spells.key('pungent_blight', 'e0.min'))).toBe(48750);
    expect(data.num(spells.key('pungent_blight', 'e0.max'))).toBe(51250);
    expect(source(spells.key('pungent_blight', 'e0.base_points'))).toMatchObject({ kind: 'spelldata', spellId: 71219, field: 'EffectBasePoints[0]' });
  });

  it('derived values follow from the registry entries named as their inputs', () => {
    const n = (key: string): number => data.num(`festergut.${key}`);
    expect(n('health')).toBe(Math.ceil(n('base_hp') * n('health_modifier')));
    expect(n('armor')).toBe(Math.ceil(n('base_armor') * n('armor_modifier')));
    expect(n('attack_time_ms')).toBe(n('base_attack_time_db') === 0 ? n('default_attack_time_ms') : n('base_attack_time_db'));
    const melee = creatureMeleeDamage({
      baseDamage: n('base_damage'),
      attackPower: n('attack_power'),
      variance: n('base_variance'),
      damageModifier: n('damage_modifier'),
      attackTimeMs: n('attack_time_ms'),
    });
    expect([n('melee_min'), n('melee_max')]).toEqual([melee.min, melee.max]);
    // The base run speed is the core entry, not a second literal.
    expect(n('speed_yd_s')).toBe(n('speed_run') * data.num('core.player_run_speed_yd_s'));
    const p = (key: string): number => data.num(`putricide.${key}`);
    const distance = Math.hypot(p('spawn_x') - p('festergut_watch_x'), p('spawn_y') - p('festergut_watch_y'), p('spawn_z') - p('festergut_watch_z'));
    expect(n('first_gas_delay_ms')).toBe(Math.trunc((distance / p('charge_speed_yd_s')) * 1000));
    // Every input of a derived value is an entry of the registry.
    for (const e of FESTERGUT_DATA_25N) {
      if (e.source.kind !== 'derived') continue;
      for (const input of e.source.inputs) expect(() => data.baselineOf(input), `${e.key} ← ${input}`).not.toThrow();
    }
  });

  it('the spawn position is the database row, with its height', () => {
    expect([data.num('festergut.spawn_x'), data.num('festergut.spawn_y'), data.num('festergut.spawn_z')]).toEqual([4267.92, 3137.26, 360.593]);
    expect(source('festergut.spawn_z')).toEqual({
      kind: 'db',
      table: 'creature',
      key: 'guid 201255 (id1 36626), column position_z (data/sql/base/db_world/creature.sql line 138459)',
      commit: PINS.azerothcoreCommit,
    });
  });

  it('the floor Gas Spore puts under Vile Gas is named as a floor (DelayEventsToMax, boss_festergut.cpp 222)', () => {
    expect(data.num('festergut.vile_gas_floor_after_spore_ms')).toBe(20000);
    expect(() => data.num('festergut.vile_gas_delay_after_spore_ms')).toThrow();
  });

  it('no value is an assumption, and only 25n exists', () => {
    expect(FESTERGUT_DATA_25N.filter((e) => e.source.kind === 'assumption')).toEqual([]);
    expect(() => festergutData('10n')).toThrow(/25n only/);
  });
});

describe('Festergut spell ids', () => {
  const spells = new FestergutSpells('25n');

  it('resolves base ids to the 25n variant and any id to its engine id', () => {
    expect(spells.variant('inhaled_blight')).toBe(71912);
    expect(spells.variant('inhale_blight')).toBe(69165);
    expect(spells.variant('gas_spore')).toBe(71221);
    expect(spells.id(69166)).toBe('inhaled_blight');
    expect(spells.id(71912)).toBe('inhaled_blight');
    expect(spells.id(69291)).toBe('inoculated');
    expect(spells.id(72103)).toBe('inoculated');
    expect(spells.id(70135)).toBe('gaseous_blight_large_damage');
    expect(() => spells.id(1)).toThrow(/not part of the Festergut fight/);
  });

  it('heroic slots that are empty fall back two modes', () => {
    expect(new FestergutSpells('25h').variant('gas_spore')).toBe(71221);
    expect(new FestergutSpells('10h').variant('pungent_blight')).toBe(73031);
  });
});
