import type { DataRegistry } from '@raid/data';
import { removeAuras, startCast, type SpellScript } from '@raid/engine';

/**
 * spell_festergut_gastric_bloat (boss_festergut.cpp 349–372), on effect 2 (SCRIPT_EFFECT): the aura stack of this hit is
 * already applied (research §6). At exactly 10 stacks the aura is removed (364), so its damage bonus does not apply, and
 * the player casts Gastric Explosion on itself, triggered and without an original caster (365; A-020): the player is the
 * damage source, so the creature area-damage avoidance does not apply and the player area cap does (A-026, A-028).
 */
export function gastricBloatScript(data: DataRegistry): SpellScript {
  const explosionStacks = data.num('festergut.gastric_bloat_explosion_stacks');
  return {
    onEffectHitTarget(ctx) {
      if (ctx.effectIndex !== 2) return;
      const { sim, targetId } = ctx;
      // GetAura(id): the aura whoever applied it.
      const bloat = [...sim.unit(targetId).auras.values()].find((a) => a.auraId === 'gastric_bloat');
      if (!bloat || bloat.stacks !== explosionStacks) return;
      removeAuras(sim, targetId, 'gastric_bloat', 'removed', ctx.causes);
      startCast(sim, targetId, 'gastric_explosion', targetId, ctx.causes, { triggered: true });
    },
  };
}
