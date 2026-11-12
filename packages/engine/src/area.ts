import type { AreaEffect } from './catalog';
import { centerDistance, positionAt } from './movement';
import type { Simulation } from './sim';
import type { Unit, Vec2 } from './units';

/** Whether `u` has the given relation to the caster: players and creatures are opposite sides. */
export function relationMatches(relation: AreaEffect['relation'], caster: Unit, u: Unit): boolean {
  if (relation === 'any') return true;
  const sameSide = caster.kind === u.kind;
  return relation === 'ally' ? sameSide : !sameSide;
}

/** The area's centre now: the caster's position, or the explicit target's (the holder's for aura effects). */
export function areaCenter(sim: Simulation, area: AreaEffect, casterId: string, targetId: string): Vec2 {
  return positionAt(sim.unit(area.center === 'caster' ? casterId : targetId), sim.now);
}

/**
 * Living units in the area, sorted by id (Spell.cpp 9504–9521, A-003): centre distance from the area centre <= radius;
 * the unit's combat reach is added only when a player caster hits a creature.
 */
export function areaTargets(sim: Simulation, caster: Unit, area: AreaEffect, center: Vec2): Unit[] {
  return sim.sortedUnits((u) => {
    if (!u.alive) return false;
    if (area.excludeCaster && u.id === caster.id) return false;
    if (!relationMatches(area.relation, caster, u)) return false;
    if (area.playersOnly && u.kind !== 'player') return false;
    const reach = caster.kind === 'player' && u.kind === 'creature' ? u.combatReach : 0;
    return centerDistance(center, positionAt(u, sim.now)) <= area.radius + reach;
  });
}
