import type { PolicyFactory } from '@raid/engine';

const configured = { kind: 'configured', file: 'packages/content/src/training-dummy/caster.ts' } as const;

/** An invented spec for demos: casts a bolt at the boss whenever it can. Its values are invented, not taken from the game. */
export const trainingCaster: PolicyFactory = {
  spec: 'training_caster',
  data: [
    ['training_caster.health', 20000],
    ['training_caster.bolt_min', 1000],
    ['training_caster.bolt_max', 1200],
    ['training_caster.bolt_cast_ms', 1500],
    ['training_caster.bolt_range_yd', 40],
  ].map(([key, value]) => ({ key, value, source: configured })),
  role: 'ranged',
  create({ sim, data }) {
    if (!sim.catalog.hasSpell('training_bolt')) {
      sim.catalog.addSpell({
        id: 'training_bolt',
        castTimeMs: data.num('training_caster.bolt_cast_ms'),
        gcdMs: 1500,
        cooldownMs: 0,
        rangeYd: data.num('training_caster.bolt_range_yd'),
        usableWhileMoving: false,
        target: 'unit',
        effects: [{ type: 'damage', school: 'fire', min: data.num('training_caster.bolt_min'), max: data.num('training_caster.bolt_max') }],
      });
    }
    return {
      unit: {
        maxHealth: data.num('training_caster.health'),
        speedYdPerSec: data.num('core.player_run_speed_yd_s'),
        combatReach: data.num('core.player_combat_reach_yd'),
        boundingRadius: data.num('core.player_bounding_radius_yd'),
      },
      policy: {
        wakeOn: { anyHealthChange: false, anyAuraChange: false },
        decide(view) {
          const boss = view.units.find((u) => u.role === 'boss' && u.alive);
          if (!boss || !view.canCast('training_bolt', boss.id).ok) return { type: 'none' };
          return { type: 'cast', spell: 'training_bolt', target: boss.id };
        },
      },
    };
  },
};
