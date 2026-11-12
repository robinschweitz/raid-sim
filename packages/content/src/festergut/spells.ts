import type { DataRegistry } from '@raid/data';
import { schoolsOfMask, type AuraModifier, type Catalog, type School, type SpellDef } from '@raid/engine';
import type { FestergutSpellName, FestergutSpells } from './spell-ids';

// Attribute bits (SharedDefines.h at the pinned commit; the line of each flag).
const ATTR0_ALLOW_CAST_WHILE_DEAD = 0x00800000; // 393
const ATTR1_EXCLUDE_CASTER = 0x00080000; // 426
const ATTR2_ALLOW_DEAD_TARGET = 0x00000001; // 444
const ATTR3_ONLY_ON_PLAYER = 0x00000100; // 489
const ATTR3_ALLOW_AURA_WHILE_DEAD = 0x00100000; // 501
const ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS = 0x20000000; // 621

/**
 * Adds every spell and aura of the fight to the catalog. Each number is read from the registry (`spell.<id>.<field>`, the
 * difficulty's variant), so it carries its `spelldata` source and the access is recorded. The position of an effect in
 * `SpellDef.effects` equals its Spell.dbc effect index wherever a spell script hooks an effect.
 *
 * Left out, each named in the mechanic statuses: the FORCE_CAST gas visuals on NPC 36659 (Gaseous Blight e1/e2), Gas
 * Spore's DUMMY aura (e1, radius 0, no target), Inoculated's PERIODIC_DUMMY (e1, value 0), Vile Gas's LINKED slow 69248
 * (e1) and missile speed, the splash's 1 s root (e1).
 */
export function addFestergutSpells(catalog: Catalog, data: DataRegistry, spells: FestergutSpells): void {
  const n = (name: FestergutSpellName, field: string): number => spells.num(data, name, field);
  const flag = (name: FestergutSpellName, field: string, bit: number): boolean => (n(name, field) & bit) !== 0;
  const schools = (name: FestergutSpellName): School[] => schoolsOfMask(n(name, 'school_mask'));
  const range = (name: FestergutSpellName, e: number) => ({ min: n(name, `e${e}.min`), max: n(name, `e${e}.max`) });
  /** SpellDuration -1 is a permanent aura. */
  const duration = (name: FestergutSpellName): number | null => (n(name, 'duration_ms') < 0 ? null : n(name, 'duration_ms'));
  /** The engine id of the spell an effect triggers. */
  const triggered = (name: FestergutSpellName, e: number): FestergutSpellName => spells.id(n(name, `e${e}.trigger_spell`));
  const playersOnly = (name: FestergutSpellName): boolean => flag(name, 'attributes_ex3', ATTR3_ONLY_ON_PLAYER);
  const ignoreCasterDamageMods = (name: FestergutSpellName): boolean => flag(name, 'attributes_ex6', ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS);
  /** Fields every boss spell shares: no global cooldown, no cooldown, castable while moving. */
  const spell = (name: FestergutSpellName, target: 'self' | 'unit', rest: Pick<SpellDef, 'effects'> & Partial<SpellDef>): SpellDef => ({
    id: name,
    castTimeMs: n(name, 'cast_time_ms'),
    gcdMs: 0,
    cooldownMs: 0,
    rangeYd: target === 'self' ? 0 : n(name, 'range_yd'),
    usableWhileMoving: true,
    target,
    ...rest,
  });
  const stacks = (name: FestergutSpellName): number => Math.max(1, n(name, 'max_stacks'));

  // Ambient Gaseous Blight: a permanent aura on Festergut whose tick makes him cast the damage spell at the room.
  for (const size of ['large', 'medium', 'small'] as const) {
    const aura: FestergutSpellName = `gaseous_blight_${size}`;
    const damage = triggered(aura, 0);
    catalog.addSpell(spell(aura, 'self', { effects: [{ type: 'apply_aura', aura }] }));
    catalog.addAura({
      id: aura,
      durationMs: duration(aura),
      maxStacks: stacks(aura),
      periodic: { intervalMs: n(aura, 'e0.amplitude_ms'), effects: [{ type: 'periodic_trigger', spell: damage }] },
    });
    catalog.addSpell(
      spell(damage, 'self', {
        effects: [
          {
            type: 'area',
            radius: n(damage, 'e0.radius_yd'),
            center: 'caster',
            relation: 'enemy',
            playersOnly: playersOnly(damage),
            effects: [{ type: 'damage', school: schools(damage), ...range(damage, 0) }],
          },
        ],
      }),
    );
  }

  // Inhale Blight: e0 SCRIPT_EFFECT without a script, e1 TRIGGER_SPELL Inhaled Blight on the caster.
  catalog.addSpell(
    spell('inhale_blight', 'self', {
      effects: [
        { type: 'on_caster', effects: [{ type: 'script' }] },
        { type: 'trigger_spell', spell: triggered('inhale_blight', 1), on: 'caster' },
      ],
    }),
  );
  catalog.addSpell(spell('inhaled_blight', 'self', { effects: [{ type: 'apply_aura', aura: 'inhaled_blight' }] }));
  catalog.addAura({
    id: 'inhaled_blight',
    durationMs: duration('inhaled_blight'),
    maxStacks: stacks('inhaled_blight'),
    modifiers: [
      // e0 MOD_DAMAGE_PERCENT_DONE, misc value = school mask (physical).
      { kind: 'damage_done_pct', pct: n('inhaled_blight', 'e0.min'), perStack: true, schools: schoolsOfMask(n('inhaled_blight', 'e0.misc_value')) },
      // e1 MOD_SCALE, e2 MOD_ATTACKSPEED.
      { kind: 'scale_pct', pct: n('inhaled_blight', 'e1.min'), perStack: true },
      { kind: 'attack_speed_pct', pct: n('inhaled_blight', 'e2.min'), perStack: true },
    ],
  });

  // Pungent Blight: e0 damage to every player, e1 SCRIPT_EFFECT on the caster, e2 TRIGGER_SPELL large Gaseous Blight.
  catalog.addSpell(
    spell('pungent_blight', 'self', {
      effects: [
        {
          type: 'area',
          radius: n('pungent_blight', 'e0.radius_yd'),
          center: 'caster',
          relation: 'enemy',
          playersOnly: playersOnly('pungent_blight'),
          effects: [{ type: 'damage', school: schools('pungent_blight'), ...range('pungent_blight', 0) }],
        },
        { type: 'on_caster', effects: [{ type: 'script' }] },
        { type: 'trigger_spell', spell: triggered('pungent_blight', 2), on: 'caster' },
      ],
    }),
  );

  // Gas Spore: e0 FORCE_CAST of the carrier aura on players in the room; the script limits it to 3 targets.
  catalog.addSpell(
    spell('gas_spore', 'self', {
      effects: [
        {
          type: 'area',
          radius: n('gas_spore', 'e0.radius_yd'),
          center: 'caster',
          relation: 'enemy',
          playersOnly: playersOnly('gas_spore'),
          effects: [{ type: 'force_cast', spell: triggered('gas_spore', 0) }],
        },
      ],
    }),
  );
  // The carrier aura: one tick at its expiry makes the carrier cast Blighted Spores.
  catalog.addSpell(spell('gas_spore_carrier', 'self', { effects: [{ type: 'apply_aura', aura: 'gas_spore_carrier' }] }));
  catalog.addAura({
    id: 'gas_spore_carrier',
    durationMs: duration('gas_spore_carrier'),
    maxStacks: stacks('gas_spore_carrier'),
    periodic: { intervalMs: n('gas_spore_carrier', 'e0.amplitude_ms'), effects: [{ type: 'periodic_trigger', spell: triggered('gas_spore_carrier', 0) }] },
  });
  // Blighted Spores: a shadow DoT on every player within 8 yd of the carrier, the carrier included.
  catalog.addSpell(
    spell('blighted_spores', 'self', {
      ignoreCasterDamageMods: ignoreCasterDamageMods('blighted_spores'),
      effects: [
        {
          type: 'area',
          radius: n('blighted_spores', 'e0.radius_yd'),
          center: 'caster',
          relation: 'ally',
          playersOnly: playersOnly('blighted_spores'),
          effects: [{ type: 'apply_aura', aura: 'blighted_spores' }],
        },
      ],
    }),
  );
  catalog.addAura({
    id: 'blighted_spores',
    durationMs: duration('blighted_spores'),
    maxStacks: stacks('blighted_spores'),
    // An area aura: another carrier's copy replaces this one (research §3, A-016).
    stackScope: 'unit_replace',
    ignoreCasterDamageMods: ignoreCasterDamageMods('blighted_spores'),
    periodic: { intervalMs: n('blighted_spores', 'e0.amplitude_ms'), effects: [{ type: 'damage', school: schools('blighted_spores'), ...range('blighted_spores', 0) }] },
  });

  // Inoculated: e0 MOD_AOE_DAMAGE_AVOIDANCE per stack for the schools of its misc value (shadow); death-persistent.
  const inoculatedDeadTarget = flag('inoculated', 'attributes_ex2', ATTR2_ALLOW_DEAD_TARGET);
  catalog.addSpell(
    spell('inoculated', 'self', {
      allowDeadCaster: flag('inoculated', 'attributes', ATTR0_ALLOW_CAST_WHILE_DEAD),
      allowDeadTarget: inoculatedDeadTarget,
      effects: [{ type: 'apply_aura', aura: 'inoculated' }],
    }),
  );
  const inoculated: AuraModifier = { kind: 'aoe_damage_taken_pct', pct: n('inoculated', 'e0.min'), perStack: true, schools: schoolsOfMask(n('inoculated', 'e0.misc_value')) };
  catalog.addAura({
    id: 'inoculated',
    durationMs: duration('inoculated'),
    maxStacks: stacks('inoculated'),
    deathPersistent: flag('inoculated', 'attributes_ex3', ATTR3_ALLOW_AURA_WHILE_DEAD),
    modifiers: [inoculated],
  });

  // Vile Gas: an aura on every player within 8 yd of the target: a DoT (e0) and a splash cast by the victim (e2).
  if (n('vile_gas', 'e0.amplitude_ms') !== n('vile_gas', 'e2.amplitude_ms')) throw new Error('Vile Gas: the DoT and the splash need the same amplitude');
  catalog.addSpell(
    spell('vile_gas', 'unit', {
      effects: [
        {
          type: 'area',
          radius: n('vile_gas', 'e0.radius_yd'),
          center: 'target',
          relation: 'enemy',
          playersOnly: playersOnly('vile_gas'),
          effects: [{ type: 'apply_aura', aura: 'vile_gas' }],
        },
      ],
    }),
  );
  catalog.addAura({
    id: 'vile_gas',
    durationMs: duration('vile_gas'),
    maxStacks: stacks('vile_gas'),
    periodic: {
      intervalMs: n('vile_gas', 'e0.amplitude_ms'),
      effects: [
        { type: 'damage', school: schools('vile_gas'), ...range('vile_gas', 0) },
        { type: 'periodic_trigger', spell: triggered('vile_gas', 2) },
      ],
    },
  });
  catalog.addSpell(
    spell('vile_gas_splash', 'self', {
      effects: [
        {
          type: 'area',
          radius: n('vile_gas_splash', 'e0.radius_yd'),
          center: 'caster',
          relation: 'ally',
          playersOnly: playersOnly('vile_gas_splash'),
          excludeCaster: flag('vile_gas_splash', 'attributes_ex', ATTR1_EXCLUDE_CASTER),
          effects: [{ type: 'damage', school: schools('vile_gas_splash'), ...range('vile_gas_splash', 0) }],
        },
      ],
    }),
  );

  // Gastric Bloat: e0 damage, e1 MOD_DAMAGE_PERCENT_DONE per stack on the victim, e2 SCRIPT_EFFECT (the explosion check).
  catalog.addSpell(
    spell('gastric_bloat', 'unit', {
      effects: [{ type: 'damage', school: schools('gastric_bloat'), ...range('gastric_bloat', 0) }, { type: 'apply_aura', aura: 'gastric_bloat' }, { type: 'script' }],
    }),
  );
  catalog.addAura({
    id: 'gastric_bloat',
    durationMs: duration('gastric_bloat'),
    maxStacks: stacks('gastric_bloat'),
    modifiers: [{ kind: 'damage_done_pct', pct: n('gastric_bloat', 'e1.min'), perStack: true, schools: schoolsOfMask(n('gastric_bloat', 'e1.misc_value')) }],
  });
  // Gastric Explosion, cast by the tank: e0 damage to players within 10 yd (the tank included), e1 INSTAKILL on the caster.
  catalog.addSpell(
    spell('gastric_explosion', 'self', {
      ignoreCasterDamageMods: ignoreCasterDamageMods('gastric_explosion'),
      allowDeadCaster: flag('gastric_explosion', 'attributes', ATTR0_ALLOW_CAST_WHILE_DEAD),
      effects: [
        {
          type: 'area',
          radius: n('gastric_explosion', 'e0.radius_yd'),
          center: 'caster',
          relation: 'ally',
          playersOnly: playersOnly('gastric_explosion'),
          effects: [{ type: 'damage', school: schools('gastric_explosion'), ...range('gastric_explosion', 0) }],
        },
        { type: 'on_caster', effects: [{ type: 'instakill' }] },
      ],
    }),
  );

  // Berserk: e0 MOD_DAMAGE_PERCENT_DONE (all schools), e1 MOD_MELEE_HASTE, e2 MOD_SCALE.
  catalog.addSpell(spell('berserk', 'self', { effects: [{ type: 'apply_aura', aura: 'berserk' }] }));
  catalog.addAura({
    id: 'berserk',
    durationMs: duration('berserk'),
    maxStacks: stacks('berserk'),
    modifiers: [
      { kind: 'damage_done_pct', pct: n('berserk', 'e0.min'), perStack: false, schools: schoolsOfMask(n('berserk', 'e0.misc_value')) },
      { kind: 'attack_speed_pct', pct: n('berserk', 'e1.min'), perStack: false },
      { kind: 'scale_pct', pct: n('berserk', 'e2.min'), perStack: false },
    ],
  });
}
