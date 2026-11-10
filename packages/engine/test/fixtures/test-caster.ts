import type { PolicyFactory } from '../../src/run';

/** A minimal spec: casts a 1.5 s bolt at the boss whenever it can. */
export const testCaster: PolicyFactory = {
  spec: 'test_caster',
  role: 'ranged',
  create({ sim, data }) {
    if (!sim.catalog.hasSpell('test_bolt')) {
      sim.catalog.addSpell({
        id: 'test_bolt',
        castTimeMs: 1500,
        gcdMs: 1500,
        cooldownMs: 0,
        rangeYd: 40,
        usableWhileMoving: false,
        target: 'unit',
        effects: [{ type: 'damage', school: 'fire', min: 1000, max: 1200 }],
      });
    }
    return {
      unit: {
        maxHealth: 20000,
        speedYdPerSec: data.num('core.player_run_speed_yd_s'),
        combatReach: data.num('core.player_combat_reach_yd'),
        boundingRadius: data.num('core.player_bounding_radius_yd'),
      },
      policy: {
        wakeOn: { anyHealthChange: false, anyAuraChange: false },
        decide(view) {
          const boss = view.units.find((u) => u.role === 'boss' && u.alive);
          if (!boss || !view.canCast('test_bolt', boss.id).ok) return { type: 'none' };
          return { type: 'cast', spell: 'test_bolt', target: boss.id };
        },
      },
    };
  },
};
