import type { BossModule } from '@raid/engine';
import { FESTERGUT_ID, FestergutAI, festergutTimers } from './ai';
import { FESTERGUT_DATA_25N } from './data';
import { blightedSporesScript } from './scripts/blighted-spores';
import { pungentBlightScript } from './scripts/pungent-blight';
import { FestergutSpells } from './spell-ids';
import { addFestergutSpells } from './spells';

/** Festergut, Icecrown Citadel, 25-player normal (other difficulties: Gate 4). */
export const festergut: BossModule = {
  id: FESTERGUT_ID,
  data: FESTERGUT_DATA_25N,
  overrides: [],
  setup({ sim, data, difficulty }) {
    if (difficulty !== '25n') throw new Error(`Festergut supports 25n only, not ${difficulty} (other difficulties: Gate 4)`);
    const n = (key: string): number => data.num(`festergut.${key}`);
    sim.addUnit({
      id: FESTERGUT_ID,
      name: 'Festergut',
      kind: 'creature',
      role: 'boss',
      level: n('level'),
      maxHealth: n('health'),
      armor: n('armor'),
      pos: { x: n('spawn_x'), y: n('spawn_y') },
      speedYdPerSec: n('speed_yd_s'),
      combatReach: n('combat_reach_yd') * n('display_scale'),
      boundingRadius: n('bounding_radius_yd') * n('display_scale'),
      melee: { minDamage: n('melee_min'), maxDamage: n('melee_max'), attackTimeMs: n('attack_time_ms') },
    });
    const spells = new FestergutSpells(difficulty);
    addFestergutSpells(sim.catalog, data, spells);
    const ai = new FestergutAI(festergutTimers(data));
    sim.catalog.addSpellScript('pungent_blight', pungentBlightScript(data, spells));
    sim.catalog.addAuraScript('blighted_spores', blightedSporesScript(data, spells, ai));
    return {
      script: ai,
      bossUnitId: FESTERGUT_ID,
      // The pull: the tank with the lowest id, or the first player when the roster has no tank.
      puller(s) {
        const players = s.players();
        const who = players.find((p) => p.role === 'tank') ?? players[0];
        if (!who) throw new Error('Festergut needs at least one player');
        return who.id;
      },
    };
  },
};
