import type { DamageModifier, SchoolSet } from './catalog';
import { overlaps } from './schools';
import type { Simulation } from './sim';
import { compareStrings, type Unit } from './units';

/** A modifier applies when its schools overlap the damage's schools (Unit.cpp 6116–6124); all schools when it names none. */
function applies(m: DamageModifier, school: SchoolSet): boolean {
  return !m.schools || overlaps(m.schools, school);
}

function factor(sim: Simulation, unit: Unit, kind: DamageModifier['kind'], school: SchoolSet): number {
  let f = 1;
  for (const key of [...unit.auras.keys()].sort(compareStrings)) {
    const inst = unit.auras.get(key)!;
    for (const m of sim.catalog.aura(inst.auraId).modifiers ?? []) {
      if (m.kind !== kind || !applies(m, school)) continue;
      f *= Math.max(0, 1 + (m.pct * (m.perStack ? inst.stacks : 1)) / 100);
    }
  }
  return f;
}

/** Product of the source's damage-done modifiers for the schools (1 when the source no longer exists). */
export function damageDoneFactor(sim: Simulation, sourceId: string, school: SchoolSet): number {
  const source = sim.units.get(sourceId);
  return source ? factor(sim, source, 'damage_done_pct', school) : 1;
}

/** Product of the target's damage-taken modifiers for the schools. */
export function damageTakenFactor(sim: Simulation, targetId: string, school: SchoolSet): number {
  return factor(sim, sim.unit(targetId), 'damage_taken_pct', school);
}

/** How damage reaches its target. */
export interface DamageRoute {
  /** Through an area effect, directly or as a tick of an aura an area applied (A-026). */
  readonly viaArea?: boolean;
  /** Skip the source's damage-done factors (SPELL_ATTR6_IGNORE_CASTER_DAMAGE_MODIFIERS). */
  readonly ignoreCasterMods?: boolean;
}

/** Unit::CalculateAOEDamageReduction (Unit.cpp 16030–16036): AoE avoidance, and creature AoE avoidance for a creature caster. */
export function aoeDamageFactor(sim: Simulation, sourceId: string, targetId: string, school: SchoolSet): number {
  const target = sim.unit(targetId);
  const creatureSource = sim.units.get(sourceId)?.kind === 'creature';
  const creature = creatureSource ? factor(sim, target, 'creature_aoe_damage_taken_pct', school) : 1;
  return factor(sim, target, 'aoe_damage_taken_pct', school) * creature;
}

/**
 * Spell damage after the modifiers, truncated to a whole number after each step in AzerothCore's order:
 * damage done, damage taken, then the area reduction (A-017, A-026).
 */
export function modifiedSpellDamage(sim: Simulation, sourceId: string, targetId: string, school: SchoolSet, rolled: number, route: DamageRoute = {}): number {
  let amount = route.ignoreCasterMods ? Math.trunc(rolled) : Math.trunc(rolled * damageDoneFactor(sim, sourceId, school));
  amount = Math.trunc(amount * damageTakenFactor(sim, targetId, school));
  if (route.viaArea) amount = Math.trunc(amount * aoeDamageFactor(sim, sourceId, targetId, school));
  return Math.max(0, amount);
}
