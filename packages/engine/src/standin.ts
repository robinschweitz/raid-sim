import { edgeDistance } from './movement';
import type { StandinMember } from './plan/schema';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import type { Unit } from './units';

/** Stand-in parameters (A-011). They are approximations by definition and reported as such. */
export const STANDIN_TICK_MS = 1000;
export const STANDIN_RANGE_YD = { tank: 5, melee: 5, ranged: 40, healer: 40 } as const;

/** Lowest health percentage in range (not lowest absolute health); ties go to the lowest id (A-011). */
function healTarget(sim: Simulation, self: Unit, range: number): Unit | null {
  let best: Unit | null = null;
  let bestRatio = 1;
  for (const p of sim.players()) {
    if (!p.alive || p.health >= p.maxHealth) continue;
    if (edgeDistance(self, p, sim.now) > range) continue;
    const ratio = p.health / p.maxHealth;
    if (ratio < bestRatio || (ratio === bestRatio && best !== null && p.id < best.id)) {
      best = p;
      bestRatio = ratio;
    }
  }
  return best;
}

export function installStandin(sim: Simulation, member: StandinMember): void {
  const range = STANDIN_RANGE_YD[member.role];
  const amount = Math.round((member.ratePerSecond * STANDIN_TICK_MS) / 1000);
  const tick = (): void => {
    const self = sim.unit(member.id);
    if (!self.alive || sim.outcome) return;
    if (!self.move && amount > 0) {
      if (member.role === 'healer') {
        const target = healTarget(sim, self, range);
        if (target) sim.heal(target.id, amount, { sourceId: self.id, ability: 'standin_heal', school: 'holy' }, []);
      } else {
        const boss = sim.bosses().find((b) => b.alive && edgeDistance(self, b, sim.now) <= range);
        if (boss) sim.damage(boss.id, amount, { sourceId: self.id, ability: 'standin_damage', school: 'physical' }, []);
      }
    }
    sim.at(sim.now + STANDIN_TICK_MS, EventClass.Decision, tick);
  };
  sim.at(sim.now + STANDIN_TICK_MS, EventClass.Decision, tick);
}
