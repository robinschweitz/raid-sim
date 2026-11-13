import type { PolicyFactory } from '@raid/engine';

const assumed = (key: string, value: number, what: string): Record<string, unknown> => ({
  key: `generic_caster.${key}`,
  value,
  source: {
    kind: 'assumption',
    rationale: `${what}; the generic caster is an ability-using stand-in, not a spec (A-035)`,
    confirmBy: 'replaced by the Fire Mage model with client spell data (Plan 3)',
  },
});

/**
 * A generic ranged damage dealer: it casts one cast-time spell at the boss whenever it can, so it stops while it moves and
 * loses a cast that movement interrupts. An ability-using stand-in (A-035): its numbers are assumptions, it has no
 * resources, haste, crits or cooldowns.
 */
export const genericCaster: PolicyFactory = {
  spec: 'generic_caster',
  role: 'ranged',
  approximate: true,
  data: [
    assumed('health', 34000, 'health of a ranged damage dealer in a 25-player normal raid'),
    assumed('bolt_min', 22000, 'lowest hit of the one damage spell'),
    assumed('bolt_max', 26000, 'highest hit of the one damage spell'),
    assumed('bolt_cast_ms', 2000, 'cast time of the one damage spell'),
    assumed('bolt_gcd_ms', 1500, 'global cooldown'),
    assumed('bolt_range_yd', 40, 'range of the one damage spell'),
  ],
  create({ sim, data }) {
    const n = (key: string): number => data.num(`generic_caster.${key}`);
    if (!sim.catalog.hasSpell('caster_bolt')) {
      sim.catalog.addSpell({
        id: 'caster_bolt',
        castTimeMs: n('bolt_cast_ms'),
        gcdMs: n('bolt_gcd_ms'),
        cooldownMs: 0,
        rangeYd: n('bolt_range_yd'),
        usableWhileMoving: false,
        target: 'unit',
        effects: [{ type: 'damage', school: 'fire', min: n('bolt_min'), max: n('bolt_max') }],
      });
    }
    return {
      unit: {
        maxHealth: n('health'),
        speedYdPerSec: data.num('core.player_run_speed_yd_s'),
        combatReach: data.num('core.player_combat_reach_yd'),
        boundingRadius: data.num('core.player_bounding_radius_yd'),
      },
      policy: {
        wakeOn: { anyHealthChange: false, anyAuraChange: false },
        decide(view) {
          const boss = view.units.find((u) => u.role === 'boss' && u.alive);
          if (!boss || !view.canCast('caster_bolt', boss.id).ok) return { type: 'none' };
          return { type: 'cast', spell: 'caster_bolt', target: boss.id };
        },
      },
    };
  },
};
