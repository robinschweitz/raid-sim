import { attachBoss, type BossScript } from './boss';
import type { Simulation } from './sim';
import { threatFor } from './threat';

/**
 * Starts an encounter the way AzerothCore engages a creature (research §9, A-033). The chain, as read at the pinned commit:
 * ThreatManager::AddThreat (ThreatManager.cpp 484–524) does SetInCombatWith, creates the ThreatReference and, with no
 * current victim, calls UpdateVictim, which sets the victim (655) and runs ProcessAIUpdates (662) →
 * JustStartedThreateningMe (728) → CreatureAI.h 131 `if (!IsEngaged()) EngagementStart(who)` → EngagementStart
 * (CreatureAI.cpp 286–296) → Creature::AtEngage (Creature.cpp 2893–2937) → JustEngagedWith(who). Zone-in-combat is script
 * side in AzerothCore (BossAI::_JustEngagedWith, ScriptedCreature.cpp 681–685, calls DoZoneInCombat, CreatureAI.cpp
 * 117–165, whose EngageWithTarget is AddThreat with 0, Unit.cpp 7336–7343); the engine does it here for every puller setup.
 * So the order is: threat reference, victim, engage event, zone-in for every other living player (0 threat, by unit id),
 * the script's engage code. Melee goes through the script's usual `meleeIfReady`. Returns the engage event id.
 */
export function engageEncounter(sim: Simulation, script: BossScript, bossUnitId: string, intervalMs: number, whoId: string): string {
  const threat = threatFor(sim);
  if (!threat) throw new Error('engageEncounter needs a threat manager');
  const who = sim.units.get(whoId);
  if (!who || who.kind !== 'player' || !who.alive) throw new Error(`engage needs a living player as who, got ${whoId}`);
  threat.add(bossUnitId, whoId, 0);
  return attachBoss(sim, script, bossUnitId, intervalMs, whoId, (engage) => {
    for (const p of sim.players()) if (p.alive) threat.add(bossUnitId, p.id, 0, [engage]);
  });
}
