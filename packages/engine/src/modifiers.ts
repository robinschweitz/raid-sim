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

/** Product of the source's damage-done and the target's damage-taken modifiers, never negative (spell effects). */
export function damageMultiplier(sim: Simulation, sourceId: string, targetId: string, school: SchoolSet): number {
  return Math.max(0, damageDoneFactor(sim, sourceId, school) * damageTakenFactor(sim, targetId, school));
}
