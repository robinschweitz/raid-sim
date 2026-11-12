import type { ActorView, PolicyAction, PolicyFactory } from '@raid/engine';

const assumed = (key: string, value: number, what: string): Record<string, unknown> => ({
  key: `generic_healer.${key}`,
  value,
  source: {
    kind: 'assumption',
    rationale: `${what}; the generic healer is an ability-using stand-in, not a spec (A-035)`,
    confirmBy: 'replaced by the Restoration Druid model with client spell data (Plan 3)',
  },
});

/**
 * The healer's choice (spec §8.6: only what a player sees). Health is counted with the heals other units are already
 * casting on a player (their cast bars; raid frames show incoming heals the same way). A tank below tankFirstBelowPct
 * percent of its health comes first; otherwise the living player in range with the lowest health percentage. A player
 * who misses less than minDeficit is skipped. Ties go to the lowest id.
 */
export function chooseHealTarget(view: ActorView, healAmount: number, minDeficit: number, tankFirstBelowPct: number): string | null {
  const incoming = new Map<string, number>();
  for (const u of view.units) {
    if (u.id !== view.self.id && u.alive && u.cast?.spell === 'healer_heal') incoming.set(u.cast.target, (incoming.get(u.cast.target) ?? 0) + healAmount);
  }
  let best: string | null = null;
  let bestRatio = Number.POSITIVE_INFINITY;
  let bestIsUrgentTank = false;
  for (const u of view.units) {
    if (u.kind !== 'player' || !u.alive) continue;
    const expected = u.health + (incoming.get(u.id) ?? 0);
    if (u.maxHealth - expected < minDeficit) continue;
    const ratio = expected / u.maxHealth;
    const urgentTank = u.role === 'tank' && ratio * 100 < tankFirstBelowPct;
    const better = urgentTank !== bestIsUrgentTank ? urgentTank : ratio < bestRatio;
    if (!better || !view.canCast('healer_heal', u.id).ok) continue;
    best = u.id;
    bestRatio = ratio;
    bestIsUrgentTank = urgentTank;
  }
  return best;
}

/**
 * A generic healer: one cast-time heal on the player who needs it most (see chooseHealTarget), with a smaller heal on a
 * few players near that target, which stands in for the area and periodic heals of real healers. An ability-using
 * stand-in (A-035): its numbers are assumptions, it has no mana, haste, crits or cooldowns, and it cannot heal while moving.
 */
export const genericHealer: PolicyFactory = {
  spec: 'generic_healer',
  role: 'healer',
  approximate: true,
  data: [
    assumed('health', 34000, 'health of a healer in a 25-player normal raid'),
    assumed('heal_min', 12000, 'lowest amount of the one heal'),
    assumed('heal_max', 14000, 'highest amount of the one heal'),
    assumed('heal_cast_ms', 1500, 'cast time of the one heal'),
    assumed('heal_gcd_ms', 1500, 'global cooldown'),
    assumed('heal_range_yd', 40, 'range of the one heal'),
    assumed('splash_min', 6500, 'lowest amount of the heal on players near the target'),
    assumed('splash_max', 7500, 'highest amount of the heal on players near the target'),
    assumed('splash_radius_yd', 10, 'players this close to the target can receive the smaller heal'),
    assumed('splash_targets', 5, 'how many players near the target receive the smaller heal'),
    assumed('heal_min_deficit', 6000, 'a player missing less health than this is not healed yet'),
    assumed('tank_first_below_pct', 85, 'a tank below this health percentage is healed before anyone else'),
  ],
  create({ sim, data }) {
    const n = (key: string): number => data.num(`generic_healer.${key}`);
    if (!sim.catalog.hasSpell('healer_heal')) {
      sim.catalog.addSpell({
        id: 'healer_heal',
        castTimeMs: n('heal_cast_ms'),
        gcdMs: n('heal_gcd_ms'),
        cooldownMs: 0,
        rangeYd: n('heal_range_yd'),
        usableWhileMoving: false,
        target: 'unit',
        effects: [
          { type: 'heal', min: n('heal_min'), max: n('heal_max') },
          // Stands in for the area and periodic heals of real healers: a smaller heal on a few players near the target.
          {
            type: 'area',
            radius: n('splash_radius_yd'),
            center: 'target',
            relation: 'ally',
            playersOnly: true,
            maxTargets: n('splash_targets'),
            effects: [{ type: 'heal', min: n('splash_min'), max: n('splash_max') }],
          },
        ],
      });
    }
    const healAmount = (n('heal_min') + n('heal_max')) / 2;
    const minDeficit = n('heal_min_deficit');
    const tankFirstBelowPct = n('tank_first_below_pct');
    return {
      unit: {
        maxHealth: n('health'),
        speedYdPerSec: data.num('core.player_run_speed_yd_s'),
        combatReach: data.num('core.player_combat_reach_yd'),
        boundingRadius: data.num('core.player_bounding_radius_yd'),
      },
      policy: {
        wakeOn: { anyHealthChange: true, anyAuraChange: false },
        decide(view): PolicyAction {
          // Nothing can be cast while moving or during the global cooldown; the controller wakes the actor afterwards.
          if (view.self.moving || view.gcdReadyAtMs > view.now) return { type: 'none' };
          const target = chooseHealTarget(view, healAmount, minDeficit, tankFirstBelowPct);
          return target === null ? { type: 'none' } : { type: 'cast', spell: 'healer_heal', target };
        },
      },
    };
  },
};
