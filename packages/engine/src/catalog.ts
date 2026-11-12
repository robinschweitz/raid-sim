import { schoolMask } from './schools';
import type { Simulation } from './sim';
import { ID_PATTERN } from './units';

export type School = 'physical' | 'holy' | 'fire' | 'nature' | 'frost' | 'shadow' | 'arcane';

/** One school, or several: a spell school mask such as nature + shadow (40). */
export type SchoolSet = School | readonly School[];

export interface DamageEffect {
  readonly type: 'damage';
  readonly school: SchoolSet;
  readonly min: number;
  readonly max: number;
}

/** An effect on one unit. */
export type LeafEffect =
  | DamageEffect
  | { readonly type: 'heal'; readonly min: number; readonly max: number }
  | { readonly type: 'apply_aura'; readonly aura: string }
  | { readonly type: 'remove_aura'; readonly aura: string }
  | { readonly type: 'taunt'; readonly durationMs: number }
  /** SCRIPT_EFFECT / DUMMY: no default handler; a spell script's onEffectHitTarget gives it meaning. */
  | { readonly type: 'script' }
  /** FORCE_CAST: the unit hit casts the spell on itself, triggered (SpellEffects.cpp 1043�1098, A-030). */
  | { readonly type: 'force_cast'; readonly spell: string };

/**
 * Effects on every unit in an area (implicit targets UNIT_SRC_AREA_* around the caster, UNIT_DEST_AREA_* around the
 * explicit target). Membership: centre distance <= radius (A-003).
 */
export interface AreaEffect {
  readonly type: 'area';
  readonly radius: number;
  /** 'caster': SRC_CASTER; 'target': the explicit target's position (for an aura effect: the holder's). */
  readonly center: 'caster' | 'target';
  /** Relation to the caster: enemy = the other side (players vs creatures), ally = the caster's side, any = both. */
  readonly relation: 'enemy' | 'ally' | 'any';
  /** SPELL_ATTR3_ONLY_ON_PLAYER (Spell.cpp 2161). */
  readonly playersOnly?: boolean;
  /** SPELL_ATTR1_EXCLUDE_CASTER: the caster is never hit (ally and any areas include it otherwise). */
  readonly excludeCaster?: boolean;
  /** MaxAffectedTargets: a random subset of this size when more units qualify (RandomResize, Spell.cpp 1414–1419). */
  readonly maxTargets?: number;
  readonly effects: readonly LeafEffect[];
}

/** Effects on the caster of the spell (implicit target TARGET_UNIT_CASTER) whatever the explicit target is. */
export interface OnCasterEffect {
  readonly type: 'on_caster';
  readonly effects: readonly LeafEffect[];
}

/** TRIGGER_SPELL: at launch the caster casts the spell, triggered, at itself or the explicit target (A-030). Spells only. */
export interface TriggerSpellEffect {
  readonly type: 'trigger_spell';
  readonly spell: string;
  readonly on: 'caster' | 'target';
}

export type Effect = LeafEffect | AreaEffect | OnCasterEffect | TriggerSpellEffect;

export interface DamageModifier {
  /**
   * damage_done_pct / damage_taken_pct: every hit. aoe_damage_taken_pct (MOD_AOE_DAMAGE_AVOIDANCE): only damage that reaches
   * the target through an area; creature_aoe_damage_taken_pct (MOD_CREATURE_AOE_DAMAGE_AVOIDANCE): the same, only when the
   * original caster (the casting unit if none) is a creature (A-026).
   */
  readonly kind: 'damage_done_pct' | 'damage_taken_pct' | 'aoe_damage_taken_pct' | 'creature_aoe_damage_taken_pct';
  /** Percent change, e.g. -25 for 25 % less. */
  readonly pct: number;
  /** Multiply the percentage by the aura's stacks. */
  readonly perStack: boolean;
  /** Applies when these schools overlap the damage's schools (misc-value mask match); all schools when absent. */
  readonly schools?: SchoolSet;
}

export type AuraRemoveReason = 'expired' | 'removed' | 'dispelled' | 'replaced' | 'death';

export interface AuraHookContext {
  readonly sim: Simulation;
  readonly unitId: string;
  readonly casterId: string;
  readonly auraId: string;
  readonly stacks: number;
  /** Stacks before this event: 0 on apply; equal to `stacks` when re-applied at max stacks and in afterRemove. */
  readonly previousStacks: number;
  readonly appliedMs: number;
  readonly refreshedMs: number;
  /** Expiry time of the instance, or null for a permanent aura. */
  readonly expiresMs: number | null;
  readonly causes: readonly string[];
}

/**
 * Hooks are not called when the unit holding the aura (or, for a spell script, the spell's target) is dead at that
 * moment. afterStack also fires when the aura is re-applied at max stacks (stacks unchanged, duration refreshed).
 */
export interface AuraScript {
  afterApply?(ctx: AuraHookContext): void;
  afterStack?(ctx: AuraHookContext): void;
  /** Called for every removal, including by death and on a dead holder (A-012). */
  afterRemove?(ctx: AuraHookContext & { readonly reason: AuraRemoveReason }): void;
}

export interface SpellHitContext {
  readonly sim: Simulation;
  readonly spellId: string;
  readonly casterId: string;
  readonly targetId: string;
  readonly causes: readonly string[];
}

export interface EffectHitContext extends SpellHitContext {
  /** Index of the spell effect (its position in SpellDef.effects) that reached this unit. */
  readonly effectIndex: number;
}

export interface SpellScript {
  /** OnEffectHitTarget: once per unit and effect, before the effect's default handler and before the damage is dealt (A-024). */
  onEffectHitTarget?(ctx: EffectHitContext): void;
  /** Runs after everything of the spell reached the unit, for every unit hit (A-024); skipped if the unit died. */
  afterHitTarget?(ctx: SpellHitContext): void;
}

export interface AuraDef {
  readonly id: string;
  /** Milliseconds, or null for a permanent aura. */
  readonly durationMs: number | null;
  readonly maxStacks: number;
  /**
   * 'caster' (default): one instance per caster; 'unit': one instance per unit, any caster stacks it; 'unit_replace': one
   * instance per unit, its caster stacks it and another caster's application replaces it (A-016).
   */
  readonly stackScope?: 'caster' | 'unit' | 'unit_replace';
  readonly periodic?: { readonly intervalMs: number; readonly effects: readonly Effect[] };
  readonly onExpire?: readonly Effect[];
  readonly modifiers?: readonly DamageModifier[];
  /**
   * SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS for this aura's periodic and on-expire damage: the caster's done factors are
   * not taken (A-029). Auras it applies from a tick or on expiry use their own flag. Keep the flag the same for every
   * application of one aura id: the instance ORs it across re-stacks (a model choice, A-028).
   */
  readonly ignoreCasterDamageMods?: boolean;
  /** Survives the holder's death (IsDeathPersistent, SpellInfo.cpp 1262; A-012). */
  readonly deathPersistent?: boolean;
}

export interface SpellDef {
  readonly id: string;
  readonly castTimeMs: number;
  readonly gcdMs: number;
  readonly cooldownMs: number;
  readonly rangeYd: number;
  readonly usableWhileMoving: boolean;
  readonly target: 'self' | 'unit';
  readonly travelSpeedYdPerSec?: number;
  /** SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS: the caster's damage-done modifiers do not apply (SpellInfo.cpp 1655–1674). */
  readonly ignoreCasterDamageMods?: boolean;
  /** SPELL_ATTR*_ALLOW_CAST_WHILE_DEAD: a dead unit may cast it (A-012). */
  readonly allowDeadCaster?: boolean;
  /** SPELL_ATTR*_ALLOW_DEAD_TARGET: it may target and hit a dead unit (A-012). */
  readonly allowDeadTarget?: boolean;
  readonly effects: readonly Effect[];
}

function checkSchools(owner: string, schools: SchoolSet): void {
  try {
    schoolMask(schools);
  } catch (e) {
    throw new Error(`${owner}: ${(e as Error).message}`);
  }
}

/** Validates effect definitions; `where` is a spell's effects, or an aura's periodic and on-expire effects. */
function checkEffects(owner: string, effects: readonly Effect[], where: 'spell' | 'aura'): void {
  for (const e of effects) {
    if (e.type === 'damage') checkSchools(owner, e.school);
    if (e.type === 'area') {
      if (!Number.isFinite(e.radius) || e.radius < 0) throw new Error(`${owner}: invalid area radius ${e.radius}`);
      if (e.maxTargets !== undefined && (!Number.isInteger(e.maxTargets) || e.maxTargets < 1)) {
        throw new Error(`${owner}: invalid maxTargets ${e.maxTargets}`);
      }
    }
    if (e.type === 'area' || e.type === 'on_caster') checkEffects(owner, e.effects, where);
    if ((e.type === 'trigger_spell' || e.type === 'force_cast') && !ID_PATTERN.test(e.spell)) {
      throw new Error(`${owner}: invalid spell id ${e.spell}`);
    }
    if (e.type === 'trigger_spell' && where !== 'spell') {
      throw new Error(`${owner}: trigger_spell is a spell effect; auras use periodic_trigger`);
    }
  }
}

export class Catalog {
  private readonly spells = new Map<string, SpellDef>();
  private readonly auras = new Map<string, AuraDef>();
  private readonly auraScripts = new Map<string, AuraScript>();
  private readonly spellScripts = new Map<string, SpellScript>();

  addSpell(def: SpellDef): void {
    if (!ID_PATTERN.test(def.id)) throw new Error(`invalid spell id ${def.id}`);
    if (this.spells.has(def.id)) throw new Error(`duplicate spell ${def.id}`);
    if (def.castTimeMs < 0 || def.gcdMs < 0 || def.cooldownMs < 0 || def.rangeYd < 0) {
      throw new Error(`negative timing or range in spell ${def.id}`);
    }
    checkEffects(def.id, def.effects, 'spell');
    this.spells.set(def.id, def);
  }

  addAura(def: AuraDef): void {
    if (!ID_PATTERN.test(def.id)) throw new Error(`invalid aura id ${def.id}`);
    if (this.auras.has(def.id)) throw new Error(`duplicate aura ${def.id}`);
    if ((def.durationMs !== null && !(def.durationMs > 0)) || !Number.isInteger(def.maxStacks) || def.maxStacks < 1) {
      throw new Error(`aura ${def.id} needs a positive duration or null (permanent), and maxStacks >= 1`);
    }
    if (def.periodic && def.periodic.intervalMs <= 0) throw new Error(`aura ${def.id} needs a positive tick interval`);
    for (const m of def.modifiers ?? []) {
      if (!Number.isFinite(m.pct)) throw new Error(`aura ${def.id} has a non-finite modifier percentage`);
      if (m.schools !== undefined) checkSchools(def.id, m.schools);
    }
    checkEffects(def.id, [...(def.periodic?.effects ?? []), ...(def.onExpire ?? [])], 'aura');
    this.auras.set(def.id, def);
  }

  addAuraScript(auraId: string, script: AuraScript): void {
    this.aura(auraId);
    if (this.auraScripts.has(auraId)) throw new Error(`duplicate aura script ${auraId}`);
    this.auraScripts.set(auraId, script);
  }

  addSpellScript(spellId: string, script: SpellScript): void {
    this.spell(spellId);
    if (this.spellScripts.has(spellId)) throw new Error(`duplicate spell script ${spellId}`);
    this.spellScripts.set(spellId, script);
  }

  auraScript(auraId: string): AuraScript | undefined {
    return this.auraScripts.get(auraId);
  }

  spellScript(spellId: string): SpellScript | undefined {
    return this.spellScripts.get(spellId);
  }

  spell(id: string): SpellDef {
    const s = this.spells.get(id);
    if (!s) throw new Error(`unknown spell ${id}`);
    return s;
  }

  aura(id: string): AuraDef {
    const a = this.auras.get(id);
    if (!a) throw new Error(`unknown aura ${id}`);
    return a;
  }

  hasSpell(id: string): boolean {
    return this.spells.has(id);
  }

  hasAura(id: string): boolean {
    return this.auras.has(id);
  }
}
