import type { AuraDef, StatModifier } from './catalog';
import type { Simulation } from './sim';
import { compareStrings, type Unit } from './units';

/** Amounts (pct × stacks where per stack) of the unit's stat modifiers of one kind, in aura key order. */
function statAmounts(sim: Simulation, unit: Unit, kind: StatModifier['kind']): number[] {
  const out: number[] = [];
  for (const key of [...unit.auras.keys()].sort(compareStrings)) {
    const inst = unit.auras.get(key)!;
    for (const m of sim.catalog.aura(inst.auraId).modifiers ?? []) {
      if (m.kind === kind) out.push(m.pct * (m.perStack ? inst.stacks : 1));
    }
  }
  return out;
}

/** Whether the aura changes unit stats, so applying, stacking or removing it needs refreshStats. */
export function hasStatModifiers(def: AuraDef): boolean {
  return (def.modifiers ?? []).some((m) => m.kind === 'attack_speed_pct' || m.kind === 'scale_pct');
}

/** MOD_SCALE amounts are summed and added to the native scale 1 (Unit.cpp 12829–12835); clamped to 0.01 for creatures and 0.1 for players (Unit.cpp 12833). */
export function scaleOf(sim: Simulation, unit: Unit): number {
  let scale = 1;
  for (const pct of statAmounts(sim, unit, 'scale_pct')) scale += pct / 100;
  return Math.max(unit.kind === 'player' ? 0.1 : 0.01, scale);
}

/**
 * Unit::ApplyAttackTimePercentMod (Unit.cpp 13135–13152): each attack-speed effect multiplies the attack time by
 * 100 / (100 + pct), a slow (negative pct) by (100 - pct) / 100; several effects multiply.
 */
export function swingTimeFactor(sim: Simulation, unit: Unit): number {
  let f = 1;
  for (const pct of statAmounts(sim, unit, 'attack_speed_pct')) f *= pct > 0 ? 100 / (100 + pct) : (100 - pct) / 100;
  return f;
}

/** The swing interval: base attack time × factor, truncated to whole ms like `int32(GetAttackTime * m_modAttackSpeedPct)` (A-031). */
export function swingIntervalMs(unit: Unit): number {
  if (!unit.melee) throw new Error(`unit ${unit.id} has no melee stats`);
  return Math.max(1, Math.trunc(unit.melee.attackTimeMs * unit.swingFactor));
}

/**
 * Recomputes stats after an aura change. A new attack speed rescales a running swing like ApplyAttackTimePercentMod: the
 * remaining fraction of the old interval (unrounded) is kept, `trunc(base × newFactor × fraction)`. An elapsed timer is left alone.
 */
export function refreshStats(sim: Simulation, unitId: string): void {
  const u = sim.unit(unitId);
  // Combat reach = model reach × scale (Creature.cpp 3591–3607).
  u.combatReach = u.baseCombatReach * scaleOf(sim, u);
  const f = swingTimeFactor(sim, u);
  if (f === u.swingFactor) return;
  const remaining = u.nextSwingMs - sim.now;
  if (u.melee && remaining > 0) {
    const fraction = remaining / (u.melee.attackTimeMs * u.swingFactor);
    // The epsilon keeps exact products such as 26.999999999999996 from losing a millisecond (A-031).
    u.nextSwingMs = sim.now + Math.trunc(u.melee.attackTimeMs * f * fraction + 1e-9);
  }
  u.swingFactor = f;
}
