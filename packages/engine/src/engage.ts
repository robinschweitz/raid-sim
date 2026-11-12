import { attachBoss, type BossScript } from './boss';
import type { Simulation } from './sim';
import { threatFor } from './threat';

/**
 * Starts an encounter the way AzerothCore engages a creature (research §9, A-033): the pulling player gets the first
 * threat reference and becomes the victim at once (ThreatManager::AddThreat creates the reference and calls UpdateVictim,
 * ThreatManager.cpp 410–524); then the engage event (JustEngagedWith(who)), zone-in-combat for every other living player
 * with 0 threat, and the script's engage code. Threat goes through the existing threat manager, melee through the script's
 * usual `meleeIfReady`. Returns the engage event id.
 */
export function engageEncounter(sim: Simulation, script: BossScript, bossUnitId: string, intervalMs: number, whoId: string): string {
  const threat = threatFor(sim);
  if (!threat) throw new Error('engageEncounter needs a threat manager');
  const who = sim.units.get(whoId);
  if (!who || who.kind !== 'player' || !who.alive) throw new Error(`engage needs a living player as who, got ${whoId}`);
  threat.add(bossUnitId, whoId, 0);
  return attachBoss(sim, script, bossUnitId, intervalMs, whoId);
}
