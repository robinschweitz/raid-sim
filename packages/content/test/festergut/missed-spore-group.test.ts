import { describe, expect, it } from 'vitest';
import { CONTENT_TEXT_EN } from '../../src/index';
import { runFestergutScenario, scenarioTextKeys, type ScenarioRun } from './scenario';

describe('scenario: a ranged player misses the spore group (spec §10.3)', () => {
  const r = runFestergutScenario('missed-spore-group');
  const clean = runFestergutScenario('clean-kill');

  it('every observation passes', () => {
    expect(r.summary.observations.filter((o) => !o.pass)).toEqual([]);
    expect(r.summary.observations).toHaveLength(4);
    expect(r.trace.meta.mistakes).toEqual(['{"player":"r06","rule":"stack-for-spores","type":"exclude_from_rule"}']);
    for (const key of scenarioTextKeys('missed-spore-group')) expect(CONTENT_TEXT_EN[key], key).toBeTruthy();
  });

  it('r06 stays at range while the other fifteen run in', () => {
    const spore = r.events('cast_start', { spell: 'gas_spore' })[0];
    const moved = r.events('rule_fired', { rule: 'stack-for-spores' }).filter((e) => e.t === spore.t).map((e) => e.data.actor);
    expect(moved).toHaveLength(15);
    expect(moved).not.toContain('r06');
    expect(r.events('move_start', { unit: 'r06' })).toEqual([]);
  });

  it('the same players carry the first three rounds of spores as in the clean kill (spec §8.7)', () => {
    // The mistake changes nobody's eligibility, so it must not shift the random picks.
    const carriers = (run: ScenarioRun) => run.events('aura_applied', { aura: 'gas_spore_carrier' }).slice(0, 9).map((e) => `${e.t}:${e.data.unit}`);
    expect(carriers(r)).toEqual(carriers(clean));
    expect(carriers(r).some((c) => c.endsWith(':r06'))).toBe(false);
  });

  it('Pungent Blight hits r06 in full and kills, while the raid takes a quarter', () => {
    const hits = r.events('damage', { ability: 'pungent_blight' });
    const own = hits.find((e) => e.data.target === 'r06')!;
    const full = Number(own.data.amount) + Number(own.data.overkill);
    expect(full).toBeGreaterThanOrEqual(48750);
    expect(full).toBeLessThanOrEqual(51250);
    expect(hits.filter((e) => e.data.target !== 'r06').every((e) => Number(e.data.amount) <= 12812)).toBe(true);
    expect(r.summary.deaths.find((d) => d.unit === 'r06')?.killingBlow).toMatchObject({ ability: 'pungent_blight', source: 'festergut' });
    expect(r.summary.deaths.map((d) => d.unit).sort()).toEqual(['festergut', 'r06']);
  });
});
