import { DataRegistry } from '@raid/data';
import { CORE_DATA, Simulation } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { festergut } from '../../src/festergut/boss';
import { FESTERGUT_BASE_IDS } from '../../src/festergut/spell-ids';
import { FESTERGUT_TEXT_EN } from '../../src/festergut/text';
import { CONTENT_TEXT_EN } from '../../src/index';

describe('English names (D6: the trace holds ids, the formatter the words)', () => {
  it('every Festergut spell and aura has a name', () => {
    const sim = new Simulation({ seed: 1, maxDurationMs: 1000, sampleIntervalMs: 1000 });
    festergut.setup({ sim, data: new DataRegistry([...CORE_DATA, ...festergut.data]), difficulty: '25n' });
    for (const id of Object.keys(FESTERGUT_BASE_IDS)) {
      expect(sim.catalog.hasSpell(id) || sim.catalog.hasAura(id), `${id} is in the catalog`).toBe(true);
      expect(CONTENT_TEXT_EN[`ability.${id}`], id).toBeTruthy();
    }
    expect(CONTENT_TEXT_EN['ability.pungent_blight']).toBe('Pungent Blight');
    expect(CONTENT_TEXT_EN['ability.gas_spore_carrier']).toBe('Gas Spore');
  });

  it('has the observation text of each Gate 1 scenario and keeps the existing texts', () => {
    for (const scenario of ['festergut_clean_kill', 'festergut_missed_spore_group', 'festergut_late_tank_swap']) {
      expect(CONTENT_TEXT_EN[`scenario.${scenario}.observation`], scenario).toBeTruthy();
    }
    expect(CONTENT_TEXT_EN['ability.melee']).toBe('Melee');
    // The clean kill depends on its seed (A-039): the observation says so.
    expect(CONTENT_TEXT_EN['scenario.festergut_clean_kill.observation']).toContain('seed-pinned');
    expect(Object.keys(FESTERGUT_TEXT_EN).every((k) => /^[a-z0-9_.]+$/.test(k))).toBe(true);
  });
});
