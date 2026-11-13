import { DataRegistry } from '@raid/data';
import { CORE_DATA, Catalog } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { FESTERGUT_DATA_25N } from '../../src/festergut/data';
import { FestergutSpells } from '../../src/festergut/spell-ids';
import { addFestergutSpells } from '../../src/festergut/spells';

function build() {
  const data = new DataRegistry([...CORE_DATA, ...FESTERGUT_DATA_25N]);
  const catalog = new Catalog();
  addFestergutSpells(catalog, data, new FestergutSpells('25n'));
  return { data, catalog };
}

describe('Festergut spells from the spell data (research §1, 25n)', () => {
  const { data, catalog } = build();

  it('every reference resolves and every value read has a spelldata or derived source', () => {
    expect(catalog.unresolvedReferences()).toEqual([]);
    const kinds = new Set(data.accessedEntries().map((e) => e.source.kind));
    expect([...kinds].sort()).toEqual(['derived', 'spelldata']);
  });

  it('Gaseous Blight: permanent auras ticking every 2 s, damage to every player in the room', () => {
    expect(catalog.aura('gaseous_blight_large')).toEqual({
      id: 'gaseous_blight_large',
      durationMs: null,
      maxStacks: 1,
      periodic: { intervalMs: 2000, effects: [{ type: 'periodic_trigger', spell: 'gaseous_blight_large_damage' }] },
    });
    const damage = (id: string) => catalog.spell(id).effects[0];
    expect(damage('gaseous_blight_large_damage')).toEqual({
      type: 'area',
      radius: 50000,
      center: 'caster',
      relation: 'enemy',
      playersOnly: true,
      effects: [{ type: 'damage', school: ['shadow'], min: 4388, max: 4612 }],
    });
    expect(damage('gaseous_blight_medium_damage')).toMatchObject({ effects: [{ min: 2925, max: 3075 }] });
    expect(damage('gaseous_blight_small_damage')).toMatchObject({ effects: [{ min: 1463, max: 1537 }] });
  });

  it('Inhale Blight and Inhaled Blight', () => {
    expect(catalog.spell('inhale_blight')).toMatchObject({
      castTimeMs: 3500,
      target: 'self',
      effects: [{ type: 'on_caster', effects: [{ type: 'script' }] }, { type: 'trigger_spell', spell: 'inhaled_blight', on: 'caster' }],
    });
    expect(catalog.aura('inhaled_blight')).toEqual({
      id: 'inhaled_blight',
      durationMs: null,
      maxStacks: 3,
      modifiers: [
        { kind: 'damage_done_pct', pct: 30, perStack: true, schools: ['physical'] },
        { kind: 'scale_pct', pct: 20, perStack: true },
        { kind: 'attack_speed_pct', pct: 30, perStack: true },
      ],
    });
  });

  it('Pungent Blight keeps the effect indices of Spell.dbc', () => {
    const s = catalog.spell('pungent_blight');
    expect(s.castTimeMs).toBe(3000);
    expect(s.effects).toEqual([
      { type: 'area', radius: 50000, center: 'caster', relation: 'enemy', playersOnly: true, effects: [{ type: 'damage', school: ['shadow'], min: 48750, max: 51250 }] },
      { type: 'on_caster', effects: [{ type: 'script' }] },
      { type: 'trigger_spell', spell: 'gaseous_blight_large', on: 'caster' },
    ]);
  });

  it('Gas Spore, its carrier aura and Blighted Spores', () => {
    expect(catalog.spell('gas_spore').effects).toEqual([
      { type: 'area', radius: 50000, center: 'caster', relation: 'enemy', playersOnly: true, effects: [{ type: 'force_cast', spell: 'gas_spore_carrier' }] },
    ]);
    expect(catalog.aura('gas_spore_carrier')).toEqual({
      id: 'gas_spore_carrier',
      durationMs: 12000,
      maxStacks: 1,
      periodic: { intervalMs: 12000, effects: [{ type: 'periodic_trigger', spell: 'blighted_spores' }] },
    });
    expect(catalog.spell('blighted_spores')).toMatchObject({
      ignoreCasterDamageMods: true,
      effects: [{ type: 'area', radius: 8, center: 'caster', relation: 'ally', playersOnly: true, effects: [{ type: 'apply_aura', aura: 'blighted_spores' }] }],
    });
    expect(catalog.aura('blighted_spores')).toEqual({
      id: 'blighted_spores',
      durationMs: 6000,
      maxStacks: 5,
      stackScope: 'unit_replace',
      ignoreCasterDamageMods: true,
      periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: ['shadow'], min: 2925, max: 3075 }] },
    });
  });

  it('Inoculated: 25 % less shadow area damage per stack, death-persistent, castable by and on the dead', () => {
    expect(catalog.spell('inoculated')).toMatchObject({ allowDeadCaster: true, allowDeadTarget: true, effects: [{ type: 'apply_aura', aura: 'inoculated' }] });
    expect(catalog.aura('inoculated')).toEqual({
      id: 'inoculated',
      durationMs: 120000,
      maxStacks: 3,
      deathPersistent: true,
      modifiers: [{ kind: 'aoe_damage_taken_pct', pct: -25, perStack: true, schools: ['shadow'] }],
    });
  });

  it('Vile Gas and its splash', () => {
    expect(catalog.spell('vile_gas')).toMatchObject({
      castTimeMs: 0,
      target: 'unit',
      rangeYd: 50000,
      effects: [{ type: 'area', radius: 8, center: 'target', relation: 'enemy', playersOnly: true, effects: [{ type: 'apply_aura', aura: 'vile_gas' }] }],
    });
    expect(catalog.spell('vile_gas').travelSpeedYdPerSec).toBeUndefined();
    expect(catalog.aura('vile_gas')).toEqual({
      id: 'vile_gas',
      durationMs: 6000,
      maxStacks: 1,
      periodic: {
        intervalMs: 2000,
        effects: [
          { type: 'damage', school: ['nature', 'shadow'], min: 4875, max: 5125 },
          { type: 'periodic_trigger', spell: 'vile_gas_splash' },
        ],
      },
    });
    expect(catalog.spell('vile_gas_splash').effects).toEqual([
      { type: 'area', radius: 8, center: 'caster', relation: 'ally', playersOnly: true, excludeCaster: true, effects: [{ type: 'damage', school: ['nature', 'shadow'], min: 4875, max: 5125 }] },
    ]);
  });

  it('Gastric Bloat and Gastric Explosion', () => {
    expect(catalog.spell('gastric_bloat').effects).toEqual([
      { type: 'damage', school: ['nature', 'shadow'], min: 12188, max: 12812 },
      { type: 'apply_aura', aura: 'gastric_bloat' },
      { type: 'script' },
    ]);
    expect(catalog.aura('gastric_bloat')).toEqual({
      id: 'gastric_bloat',
      durationMs: 100000,
      maxStacks: 10,
      modifiers: [{ kind: 'damage_done_pct', pct: 10, perStack: true, schools: ['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane'] }],
    });
    expect(catalog.spell('gastric_explosion')).toMatchObject({
      ignoreCasterDamageMods: true,
      allowDeadCaster: true,
      effects: [
        { type: 'area', radius: 10, center: 'caster', relation: 'ally', playersOnly: true, effects: [{ type: 'damage', school: ['nature', 'shadow'], min: 29250, max: 30750 }] },
        { type: 'on_caster', effects: [{ type: 'instakill' }] },
      ],
    });
    expect(catalog.spell('gastric_explosion').allowDeadTarget).toBeUndefined();
  });

  it('Berserk', () => {
    expect(catalog.aura('berserk')).toEqual({
      id: 'berserk',
      durationMs: 1800000,
      maxStacks: 1,
      modifiers: [
        { kind: 'damage_done_pct', pct: 900, perStack: false, schools: ['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane'] },
        { kind: 'attack_speed_pct', pct: 150, perStack: false },
        { kind: 'scale_pct', pct: 25, perStack: false },
      ],
    });
  });
});
