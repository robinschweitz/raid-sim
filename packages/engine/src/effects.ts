import { areaCenter, areaTargets } from './area';
import { applyAura, removeAuras } from './auras';
import type { Effect, LeafEffect } from './catalog';
import { modifiedSpellDamage } from './modifiers';
import type { Simulation } from './sim';
import { threatFor } from './threat';

export interface EffectContext {
  readonly casterId: string;
  readonly targetId: string;
  readonly ability: string;
  readonly causes: readonly string[];
  /** The effect reaches the target through an area: area modifiers apply (A-026). */
  readonly viaArea?: boolean;
}

export function applyEffects(sim: Simulation, effects: readonly Effect[], ctx: EffectContext): void {
  for (const e of effects) applyEffect(sim, e, ctx);
}

function applyEffect(sim: Simulation, e: Effect, ctx: EffectContext): void {
  switch (e.type) {
    case 'area': {
      const hit = areaTargets(sim, sim.unit(ctx.casterId), e, areaCenter(sim, e, ctx.casterId, ctx.targetId));
      for (const u of hit) applyEffects(sim, e.effects, { ...ctx, targetId: u.id, viaArea: true });
      return;
    }
    default:
      applyLeafEffect(sim, e, ctx);
  }
}

/** One effect on one unit. */
export function applyLeafEffect(sim: Simulation, e: LeafEffect, ctx: EffectContext): void {
  const target = sim.unit(ctx.targetId);
  switch (e.type) {
    case 'damage': {
      if (!target.alive) return;
      const rolled = sim.rng.stream(`unit:${ctx.casterId}.amount`).int(e.min, e.max);
      const amount = modifiedSpellDamage(sim, ctx.casterId, target.id, e.school, rolled, { viaArea: ctx.viaArea === true });
      sim.damage(target.id, amount, { sourceId: ctx.casterId, ability: ctx.ability, school: e.school }, ctx.causes);
      return;
    }
    case 'heal': {
      if (!target.alive) return;
      const amount = sim.rng.stream(`unit:${ctx.casterId}.amount`).int(e.min, e.max);
      sim.heal(target.id, amount, { sourceId: ctx.casterId, ability: ctx.ability, school: 'holy' }, ctx.causes);
      return;
    }
    case 'apply_aura':
      applyAura(sim, e.aura, ctx.casterId, target.id, ctx.causes, { viaArea: ctx.viaArea === true });
      return;
    case 'remove_aura':
      removeAuras(sim, target.id, e.aura, 'removed', ctx.causes);
      return;
    case 'taunt':
      threatFor(sim)?.taunt(target.id, ctx.casterId, e.durationMs, ctx.causes);
      return;
  }
}
