import type { DataRegistry } from '@raid/data';
import { removeAuras, type SpellScript } from '@raid/engine';
import type { FestergutSpells } from '../spell-ids';

/**
 * spell_festergut_pungent_blight (boss_festergut.cpp 275–313). Effect 0 (the damage), per player hit: Inoculated is
 * removed (HandleHit, 302–306); the hook runs before the damage is dealt, but the damage was fixed at launch, so the
 * stacks still reduce this hit (research §6, A-024). Effect 1 (SCRIPT_EFFECT on the caster): its value names Inhaled
 * Blight, whose difficulty variant is removed from Festergut (HandleScript, 284–300). Putricide's talk and gas visual
 * (297–299) are cosmetic and left out.
 */
export function pungentBlightScript(data: DataRegistry, spells: FestergutSpells): SpellScript {
  // GetEffectValue() of effect 1 is the base Inhaled Blight id; GetSpellIdForDifficulty resolves the variant (291).
  const inhaledBlight = spells.id(spells.num(data, 'pungent_blight', 'e1.min'));
  return {
    onEffectHitTarget(ctx) {
      if (ctx.effectIndex === 0) removeAuras(ctx.sim, ctx.targetId, 'inoculated', 'removed', ctx.causes);
      else if (ctx.effectIndex === 1) removeAuras(ctx.sim, ctx.casterId, inhaledBlight, 'removed', ctx.causes);
    },
  };
}
