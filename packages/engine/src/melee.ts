import { damageDoneFactor, damageTakenFactor } from './modifiers';
import { withinMeleeRange } from './movement';
import type { Simulation } from './sim';
import type { Avoidance, Unit } from './units';

/** Unit::CalcArmorReducedDamage (Unit.cpp 2233–2300): reduction = r / (1 + r), r = 0.1 armor / (8.5 L' + 40), capped at 75 %. */
export function armorReduction(armor: number, attackerLevel: number): number {
  const level = attackerLevel > 59 ? attackerLevel + 4.5 * (attackerLevel - 59) : attackerLevel;
  const r = (0.1 * Math.max(0, armor)) / (8.5 * level + 40);
  return Math.min(Math.max(r / (1 + r), 0), 0.75);
}

export interface CreatureMeleeInput {
  readonly baseDamage: number;
  readonly attackPower: number;
  readonly variance: number;
  readonly damageModifier: number;
  readonly attackTimeMs: number;
}

/**
 * Creature::CalculateMinMaxDamage (StatSystem.cpp 1117) with weapon min = base, max = 1.5 × base (Creature.cpp 1554)
 * and the attack-time multiplier (Unit.cpp 13306); truncated to whole numbers before the roll.
 */
export function creatureMeleeDamage(p: CreatureMeleeInput): { min: number; max: number } {
  const ap = (p.attackPower / 14) * p.variance;
  const mult = p.damageModifier * (p.attackTimeMs / 1000);
  return { min: Math.trunc((p.baseDamage + ap) * mult), max: Math.trunc((p.baseDamage * 1.5 + ap) * mult) };
}

/**
 * Unit::RollMeleeOutcomeAgainst converts each chance with `int32(chance * 100.0f)` (Unit.cpp ~3478 and ~3500): float32 arithmetic,
 * truncated toward zero.
 */
function hundredths(pct: number): number {
  return Math.trunc(Math.fround(Math.fround(pct) * 100));
}

/**
 * Attack table roll in hundredths of a percent: AzerothCore rolls `urand(0, 10000)`, so 0..10000 inclusive. Miss, then dodge, then parry;
 * each chance is converted to whole hundredths first. The checks are `roll < running sum` (Unit.cpp 3040+), so a roll equal to the total
 * avoidance falls through to a hit, even for 100 % avoidance on a roll of exactly 10000.
 */
export function meleeOutcome(roll: number, avoidance: Avoidance): 'miss' | 'dodge' | 'parry' | 'hit' {
  const miss = hundredths(avoidance.missPct);
  const dodge = miss + hundredths(avoidance.dodgePct);
  const parry = dodge + hundredths(avoidance.parryPct);
  return roll < miss ? 'miss' : roll < dodge ? 'dodge' : roll < parry ? 'parry' : 'hit';
}

/**
 * DoMeleeAttackIfReady: one swing when the swing timer is ready, the attacker is not casting and the victim is in melee range.
 * Outcomes: miss, dodge, parry from the victim's avoidance; no crits, crushing, glancing or block (A-022).
 */
export function meleeIfReady(sim: Simulation, attackerId: string, victim: Unit | null, causes: readonly string[] = []): string | null {
  const a = sim.unit(attackerId);
  if (!a.alive || sim.over || !a.melee || a.cast || !victim || !victim.alive) return null;
  if (sim.now < a.nextSwingMs || !withinMeleeRange(a, victim, sim.now)) return null;
  a.nextSwingMs = sim.now + a.melee.attackTimeMs;
  const rng = sim.rng.stream(`unit:${a.id}.melee`);
  const result = meleeOutcome(rng.int(0, 10000), victim.avoidance);
  if (result !== 'hit') return sim.emit('melee_avoided', { source: a.id, target: victim.id, result }, causes);
  const raw = rng.int(a.melee.minDamage, a.melee.maxDamage);
  // CalculateMeleeDamage (Unit.cpp 1760-1790): the uint32 damage goes through MeleeDamageBonusDone, then MeleeDamageBonusTaken (each
  // truncated), then CalcArmorReducedDamage, which ends in `uint32(ceil(damage * (1 - armorReduction)))`.
  const afterDone = Math.trunc(raw * damageDoneFactor(sim, a.id, 'physical'));
  const afterTaken = Math.trunc(afterDone * damageTakenFactor(sim, victim.id, 'physical'));
  const mitigated = Math.ceil(afterTaken * (1 - armorReduction(victim.armor, a.level)));
  return sim.damage(victim.id, mitigated, { sourceId: a.id, ability: 'melee', school: 'physical' }, causes);
}
