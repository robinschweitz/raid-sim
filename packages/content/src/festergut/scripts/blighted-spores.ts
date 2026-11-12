import type { DataRegistry } from '@raid/data';
import { auraKey, startCast, type AuraScript } from '@raid/engine';
import { DATA_INOCULATED_STACK, type FestergutAI } from '../ai';
import type { FestergutSpells } from '../spell-ids';

/**
 * spell_festergut_blighted_spores_aura (boss_festergut.cpp 315–347): when Blighted Spores leaves a player, for any
 * reason and also on a dead player (A-012), the player casts Inoculated on itself, unless
 * - the removed aura was applied less than 1 s ago (327: it is being replaced by another carrier's copy), or
 * - the player's Inoculated was gained or refreshed less than 10 s ago (334: one stack per round of spores).
 * The cast has no original caster (`GetTarget()->CastSpell(GetTarget(), SPELL_INOCULATED, true)`, 337; A-020). The stack
 * the player reaches is reported to Festergut's AI like `festergut->AI()->SetData` (338–340).
 */
export function blightedSporesScript(data: DataRegistry, spells: FestergutSpells, ai: FestergutAI): AuraScript {
  const freshMs = data.num('festergut.blighted_spores_fresh_ms');
  const oncePerMs = data.num('festergut.inoculated_once_per_ms');
  const sporesDurationMs = spells.num(data, 'blighted_spores', 'duration_ms');
  const inoculatedDurationMs = spells.num(data, 'inoculated', 'duration_ms');
  return {
    afterRemove(ctx) {
      const { sim, unitId } = ctx;
      // GetDuration() > GetMaxDuration() - 1000 (327).
      if (ctx.expiresMs !== null && ctx.expiresMs - sim.now > sporesDurationMs - freshMs) return;
      const inoculated = sim.unit(unitId).auras.get(auraKey('inoculated', unitId));
      let stack = 1;
      if (inoculated) {
        stack += inoculated.stacks;
        // GetDuration() > GetMaxDuration() - 10000 (334).
        if (inoculated.expiresMs - sim.now > inoculatedDurationMs - oncePerMs) return;
      }
      const cast = startCast(sim, unitId, 'inoculated', unitId, ctx.causes, { triggered: true });
      if (cast.ok) ai.setData(DATA_INOCULATED_STACK, stack);
    },
  };
}
