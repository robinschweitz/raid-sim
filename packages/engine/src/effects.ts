import { areaCenter, areaTargets, limitTargets } from './area';
import { applyAura, removeAuras } from './auras';
import { startCast } from './casting';
import type { DamageEffect, Effect, LeafEffect } from './catalog';
import { modifiedSpellDamage, type DamageRoute } from './modifiers';
import type { Simulation } from './sim';
import { threatFor } from './threat';

export interface EffectContext {
  /** The casting unit: area relation, range and taunts (A-020). */
  readonly casterId: string;
  /** The unit the spell is cast for; owns damage, healing and applied auras. Defaults to `casterId` (A-020). */
  readonly originalCasterId?: string;
  readonly targetId: string;
  readonly ability: string;
  readonly causes: readonly string[];
  /** The effect reaches the target through an area: area modifiers apply (A-026). */
  readonly viaArea?: boolean;
  /**
   * The spell (or aura) skips the caster's damage-done factors for the damage it deals (A-028). It also passes to the
   * auras applied from a spell context, but not from an aura's own tick or on-expire effects (`fromAura`): a child aura is
   * a separate SpellInfo in AzerothCore and uses its own definition's flag.
   */
  readonly ignoreCasterMods?: boolean;
  /** The effect runs from an aura's tick or on-expire effects: `ignoreCasterMods` is not forwarded to auras applied here. */
  readonly fromAura?: boolean;
}

/** The unit that owns an effect's damage, healing and auras (AzerothCore's m_originalCaster, A-020). */
export const sourceOf = (ctx: EffectContext): string => ctx.originalCasterId ?? ctx.casterId;

/**
 * Effects outside a spell launch: aura ticks and on-expire effects (spells resolve through launchSpell). The aura contexts
 * pass the aura's owner (its caster) as `casterId`; `originalCasterId` is only set on the launch path.
 */
export function applyEffects(sim: Simulation, effects: readonly Effect[], ctx: EffectContext): void {
  for (const e of effects) applyEffect(sim, e, ctx);
}

function applyEffect(sim: Simulation, e: Effect, ctx: EffectContext): void {
  switch (e.type) {
    case 'area': {
      const found = areaTargets(sim, sim.unit(ctx.casterId), e, areaCenter(sim, e, ctx.casterId, ctx.targetId));
      const hit = limitTargets(sim, found, e.maxTargets, `unit:${ctx.casterId}.${ctx.ability}.targets`);
      for (const u of hit) applyEffects(sim, e.effects, { ...ctx, targetId: u.id, viaArea: true });
      return;
    }
    case 'on_caster':
      // Lands on the caster directly, not through an area, even when the surrounding effect came through one.
      applyEffects(sim, e.effects, { ...ctx, targetId: ctx.casterId, viaArea: false });
      return;
    case 'trigger_spell':
      throw new Error(`${ctx.ability}: trigger_spell only runs at a spell's launch`);
    default:
      applyLeafEffect(sim, e, ctx);
  }
}

/** Rolls a damage effect and applies the modifiers in effect now, truncated after each step (A-017, A-026). */
export function rollDamage(sim: Simulation, casterId: string, targetId: string, e: DamageEffect, route: DamageRoute = {}): number {
  const rolled = sim.rng.stream(`unit:${casterId}.amount`).int(e.min, e.max);
  return modifiedSpellDamage(sim, casterId, targetId, e.school, rolled, route);
}

/** One effect on one unit. */
export function applyLeafEffect(sim: Simulation, e: LeafEffect, ctx: EffectContext): void {
  const target = sim.unit(ctx.targetId);
  switch (e.type) {
    case 'damage': {
      if (!target.alive) return;
      const amount = rollDamage(sim, sourceOf(ctx), target.id, e, { viaArea: ctx.viaArea === true, ignoreCasterMods: ctx.ignoreCasterMods === true });
      sim.damage(target.id, amount, { sourceId: sourceOf(ctx), ability: ctx.ability, school: e.school }, ctx.causes);
      return;
    }
    case 'heal': {
      if (!target.alive) return;
      const amount = sim.rng.stream(`unit:${sourceOf(ctx)}.amount`).int(e.min, e.max);
      sim.heal(target.id, amount, { sourceId: sourceOf(ctx), ability: ctx.ability, school: 'holy' }, ctx.causes);
      return;
    }
    case 'apply_aura':
      applyAura(sim, e.aura, sourceOf(ctx), target.id, ctx.causes, { viaArea: ctx.viaArea === true, ignoreCasterMods: ctx.ignoreCasterMods === true && ctx.fromAura !== true });
      return;
    case 'remove_aura':
      removeAuras(sim, target.id, e.aura, 'removed', ctx.causes);
      return;
    case 'taunt':
      threatFor(sim)?.taunt(target.id, ctx.casterId, e.durationMs, ctx.causes);
      return;
    case 'script':
      return;
    case 'force_cast':
      castOnSelf(sim, e.spell, ctx);
      return;
    case 'periodic_trigger':
      // The triggering aura's caster becomes the original caster (Unit.cpp 1387-1389).
      castOnSelf(sim, e.spell, ctx, sourceOf(ctx));
      return;
    case 'instakill':
      // No modifiers: the damage is the target's current health (SpellEffects.cpp 279-292); sim.damage handles death.
      if (!target.alive) return;
      sim.damage(target.id, target.health, { sourceId: sourceOf(ctx), ability: ctx.ability, school: 'physical' }, ctx.causes);
      return;
  }
}

/**
 * The unit casts the spell on itself, triggered (A-030). `owner` becomes the original caster of that cast: force_cast
 * passes none, so the forced unit owns its own spell (SpellEffects.cpp 1081–1096 casts without an original caster);
 * periodic_trigger passes the aura's caster (Unit.cpp 1387–1389 takes the triggering aura's caster).
 */
function castOnSelf(sim: Simulation, spellId: string, ctx: EffectContext, owner?: string): void {
  startCast(sim, ctx.targetId, spellId, ctx.targetId, ctx.causes, owner === undefined ? { triggered: true } : { triggered: true, originalCasterId: owner });
}
