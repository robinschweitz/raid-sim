import type { Unit, Vec2 } from './units';

export function centerDistance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Position at time t; straight line at constant speed (A-004). */
export function positionAt(u: Unit, t: number): Vec2 {
  const m = u.move;
  if (!m) return u.pos;
  if (t >= m.arrivalMs) return m.to;
  const total = centerDistance(m.from, m.to);
  if (total === 0) return m.to;
  const frac = Math.min(1, Math.max(0, (((t - m.startMs) / 1000) * m.speed) / total));
  return { x: m.from.x + (m.to.x - m.from.x) * frac, y: m.from.y + (m.to.y - m.from.y) * frac };
}

export function travelTimeMs(from: Vec2, to: Vec2, speedYdPerSec: number): number {
  const distance = centerDistance(from, to);
  if (distance === 0) return 0;
  if (!(speedYdPerSec > 0)) throw new Error('speed must be positive');
  return Math.ceil((distance * 1000) / speedYdPerSec);
}

/** Range between two units: centre distance minus both combat reaches, never negative (A-003). */
export function edgeDistance(a: Unit, b: Unit, t: number): number {
  return Math.max(0, centerDistance(positionAt(a, t), positionAt(b, t)) - a.combatReach - b.combatReach);
}

/** Area check: distance from an area centre to a unit's edge, never negative (A-003). */
export function pointToEdge(p: Vec2, u: Unit, t: number): number {
  return Math.max(0, centerDistance(p, positionAt(u, t)) - u.combatReach);
}

/** AzerothCore NOMINAL_MELEE_RANGE (ObjectDefines.h line 47). */
export const NOMINAL_MELEE_RANGE_YD = 5;

/** AzerothCore Unit::GetMeleeRange (Unit.cpp lines 807–811): both combat reaches + 4/3, at least 5 yd, centre to centre. */
export function meleeRange(a: Unit, b: Unit): number {
  return Math.max(a.combatReach + b.combatReach + 4 / 3, NOMINAL_MELEE_RANGE_YD);
}

/** Without AzerothCore's leeway bonus for two moving units (adaptation A-022). */
export function withinMeleeRange(a: Unit, b: Unit, t: number): boolean {
  return centerDistance(positionAt(a, t), positionAt(b, t)) <= meleeRange(a, b);
}
