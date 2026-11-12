import { areaCenter, areaTargets, limitTargets } from './area';
import { applyAura } from './auras';
import type { AreaEffect, LeafEffect, SpellDef, TriggerSpellEffect } from './catalog';
import { startCast } from './casting';
import { applyLeafEffect, rollDamage } from './effects';
import { positionAt, travelTimeMs } from './movement';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import type { Unit } from './units';

export interface LaunchOptions {
  /** SPELLVALUE_MAX_TARGETS: overrides the maxTargets of every area effect of the spell. */
  readonly maxTargets?: number;
  /** Stream for the random subset; default `unit:<caster>.<spell>.targets` (A-027). */
  readonly targetStream?: string;
  /** The unit the spell is cast for: it owns damage, healing, threat and applied auras (A-020). */
  readonly originalCasterId?: string;
}

/** Spell.cpp 8730–8735: a player's area damage on more units than this is scaled by cap / units (A-028). */
export const PLAYER_AOE_TARGET_CAP = 10;

/** One effect of a spell on one unit. */
interface Item {
  readonly index: number;
  readonly effect: LeafEffect | TriggerSpellEffect;
  readonly viaArea: boolean;
  /** Damage fixed at launch (damage effects only). */
  amount: number;
}

/**
 * Resolves a successful cast like Spell::_cast (Spell.cpp 4031–4177, research §6, A-024): every effect selects its units;
 * then, per unit in order of first appearance and per effect in effect order, damage is fixed with the modifiers in
 * effect now (DoAllEffectOnLaunchTarget, Spell.cpp 8650–8745); then every unit is hit, when the spell reaches its
 * explicit target.
 */
export function launchSpell(
  sim: Simulation,
  casterId: string,
  spell: SpellDef,
  targetId: string,
  cause: string,
  options: LaunchOptions = {},
): void {
  const caster = sim.unit(casterId);
  // AzerothCore's m_originalCaster (Spell.cpp 2680): defaults to the casting unit; a dead one still counts, units stay in the world.
  const sourceId = options.originalCasterId ?? casterId;
  const lists = new Map<string, readonly Unit[]>();
  /** Effects with the same targeting share one unit list (Spell.cpp 1002–1011). */
  const areaUnits = (e: AreaEffect): readonly Unit[] => {
    const limit = options.maxTargets ?? e.maxTargets;
    const key = JSON.stringify([e.radius, e.center, e.relation, e.playersOnly === true, e.excludeCaster === true, limit ?? null]);
    let units = lists.get(key);
    if (!units) {
      const found = areaTargets(sim, caster, e, areaCenter(sim, e, casterId, targetId));
      units = limitTargets(sim, found, limit, options.targetStream ?? `unit:${casterId}.${spell.id}.targets`);
      lists.set(key, units);
    }
    return units;
  };
  const deliveries = new Map<string, Item[]>();
  const add = (unitId: string, index: number, effect: LeafEffect | TriggerSpellEffect, viaArea: boolean): void => {
    let items = deliveries.get(unitId);
    if (!items) deliveries.set(unitId, (items = []));
    items.push({ index, effect, viaArea, amount: 0 });
  };
  spell.effects.forEach((e, index) => {
    if (e.type === 'area') {
      for (const u of areaUnits(e)) {
        for (const leaf of e.effects) add(u.id, index, leaf, true);
      }
    } else if (e.type === 'on_caster') {
      for (const leaf of e.effects) add(casterId, index, leaf, false);
    } else if (e.type === 'trigger_spell') {
      add(e.on === 'caster' ? casterId : targetId, index, e, false);
    } else {
      add(targetId, index, e, false);
    }
  });
  // The cap counts every unit the spell hits (m_UniqueTargetInfo) and comes after the modifier steps, truncated like them.
  const capped = caster.kind === 'player' && deliveries.size > PLAYER_AOE_TARGET_CAP;
  const ignoreCasterMods = spell.ignoreCasterDamageMods === true;
  for (const [unitId, items] of deliveries) {
    for (const it of items) {
      if (it.effect.type === 'trigger_spell') {
        // EffectTriggerSpell in LAUNCH_TARGET mode (SpellEffects.cpp 808�812): cast now, before any unit is hit.
        startCast(sim, casterId, it.effect.spell, unitId, [cause], { triggered: true, originalCasterId: sourceId });
        continue;
      }
      if (it.effect.type !== 'damage') continue;
      const amount = rollDamage(sim, sourceId, unitId, it.effect, { ignoreCasterMods, viaArea: it.viaArea });
      it.amount = capped && it.viaArea ? Math.trunc((amount * PLAYER_AOE_TARGET_CAP) / deliveries.size) : amount;
    }
  }
  const deliver = (): void => {
    for (const [unitId, items] of deliveries) hitUnit(sim, casterId, sourceId, spell, unitId, items, cause);
  };
  if (spell.travelSpeedYdPerSec && targetId !== casterId) {
    const delay = travelTimeMs(positionAt(caster, sim.now), positionAt(sim.unit(targetId), sim.now), spell.travelSpeedYdPerSec);
    sim.at(sim.now + delay, EventClass.SpellHit, deliver);
  } else {
    deliver();
  }
}

/** DoSpellHitOnUnit and the damage after it (Spell.cpp 3253, 3336–3354, 5866–5871, 2885–2957). */
function hitUnit(sim: Simulation, casterId: string, sourceId: string, spell: SpellDef, unitId: string, items: readonly Item[], cause: string): void {
  const unit = sim.unit(unitId);
  const deadOk = spell.allowDeadTarget === true;
  if ((!unit.alive && !deadOk) || sim.over) return;
  const hitId = sim.emit('spell_hit', { caster: casterId, spell: spell.id, target: unitId }, [cause]);
  const causes = [hitId];
  const script = sim.catalog.spellScript(spell.id);
  // The spell's auras first.
  for (const it of items) {
    if (it.effect.type === 'apply_aura') applyAura(sim, it.effect.aura, sourceId, unitId, causes, { viaArea: it.viaArea, allowDeadTarget: deadOk, ignoreCasterMods: spell.ignoreCasterDamageMods === true });
  }
  // Then per effect: the OnEffectHitTarget hook, then the effect's default handler.
  for (const index of [...new Set(items.map((it) => it.index))]) {
    if (!unit.alive && !deadOk) return;
    script?.onEffectHitTarget?.({ sim, spellId: spell.id, casterId, targetId: unitId, effectIndex: index, causes });
    // The hook may have killed the unit: no default handler runs on it.
    if (!unit.alive && !deadOk) return;
    for (const it of items) {
      if (it.index !== index || it.effect.type === 'apply_aura' || it.effect.type === 'damage' || it.effect.type === 'trigger_spell') continue;
      applyLeafEffect(sim, it.effect, { casterId, originalCasterId: sourceId, targetId: unitId, ability: spell.id, causes, viaArea: it.viaArea, ignoreCasterMods: spell.ignoreCasterDamageMods === true });
    }
  }
  // The damage fixed at launch is dealt last.
  for (const it of items) {
    if (it.effect.type === 'damage') sim.damage(unitId, it.amount, { sourceId, ability: spell.id, school: it.effect.school }, causes);
  }
  if (!unit.alive && !deadOk) return;
  script?.afterHitTarget?.({ sim, spellId: spell.id, casterId, targetId: unitId, causes });
}
