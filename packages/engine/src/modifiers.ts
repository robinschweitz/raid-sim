import type { DamageModifier, School } from './catalog';
import type { Simulation } from './sim';
import { compareStrings, type Unit } from './units';

function applies(m: DamageModifier, school: School): boolean {
  return !m.schools || m.schools.includes(school);
}

function factor(sim: Simulation, unit: Unit, kind: DamageModifier['kind'], school: School): number {
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

/** Product of the source's damage-done and the target's damage-taken modifiers, never negative. */
export function damageMultiplier(sim: Simulation, sourceId: string, targetId: string, school: School): number {
  const source = sim.units.get(sourceId);
  const target = sim.unit(targetId);
  const done = source ? factor(sim, source, 'damage_done_pct', school) : 1;
  return Math.max(0, done * factor(sim, target, 'damage_taken_pct', school));
}
