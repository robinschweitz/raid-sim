import { readFileSync } from 'node:fs';
import { canonicalStringify, parsePlan } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { CONTENT_TEXT_EN } from '../../src/index';
import { runFestergutScenario, scenarioTextKeys } from './scenario';

describe('scenario: Festergut clean kill (spec §10.3)', () => {
  const r = runFestergutScenario('clean-kill');

  it('kills Festergut before the berserk with every observation passing', () => {
    expect(r.summary.outcome).toBe('kill');
    expect(r.summary.durationMs).toBeLessThan(300000);
    expect(r.summary.observations.filter((o) => !o.pass)).toEqual([]);
    expect(r.summary.observations.map((o) => o.check)).toEqual([
      'outcome_is',
      'event_absent:cast_start',
      'custom:raid.no_player_deaths',
      'custom:festergut.inoculated_at_pungent',
      'event_occurs:taunt',
      'event_absent:cast_start',
    ]);
    for (const key of scenarioTextKeys('clean-kill')) expect(CONTENT_TEXT_EN[key], key).toBeTruthy();
  });

  it('an event held by a boss cast executes after its window (A-034): Gastric Bloat waits for Inhale Blight', () => {
    const window = r.trace.events.filter((e) => e.kind === 'timer_window' && e.data.ability === 'gastric_bloat' && e.t < 97510).at(-1)!;
    expect([window.data.earliestMs, window.data.latestMs]).toEqual([94540, 97040]);
    const bloat = r.trace.events.find((e) => e.kind === 'ai_event' && e.data.event === 'gastric_bloat' && e.t > window.t)!;
    expect(bloat.t).toBe(97510);
    const inhale = r.trace.events.filter((e) => e.kind === 'cast_success' && e.data.spell === 'inhale_blight' && e.t <= bloat.t).at(-1)!;
    expect(inhale.t).toBe(97510);
  });

  it('the plan names the ranged group once (a YAML anchor) and both spore rules get the same 16 players', () => {
    const text = readFileSync('scenarios/festergut/plan-25n.yaml', 'utf8');
    const plan = parsePlan('plan-25n.yaml', text);
    if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
    const ranged = ['h3', 'h4', 'h5', 'h6', 'r01', 'r02', 'r03', 'r04', 'r05', 'r06', 'r07', 'r08', 'r09', 'r10', 'r11', 'r12'];
    const who = (id: string) => plan.value.rules.find((x) => x.id === id)!.who;
    expect(who('stack-for-spores')).toEqual(ranged);
    expect(who('spread-after-spores')).toEqual(ranged);
    expect(text).toContain('&ranged');
    expect(text).toContain('*ranged');
  });

  it('the raid stacks for the spores and spreads again before Vile Gas', () => {
    const spore = r.events('cast_start', { spell: 'gas_spore' })[0];
    expect(r.events('rule_fired', { rule: 'stack-for-spores' }).filter((e) => e.t === spore.t)).toHaveLength(16);
    expect(r.events('rule_fired', { rule: 'spread-after-spores' }).filter((e) => e.t === spore.t + 12000)).toHaveLength(16);
    const vile = r.events('ai_event', { event: 'vile_gas' })[0];
    expect(vile.t).toBeGreaterThanOrEqual(spore.t + 20000);
    // Sixteen players are back at range, so Vile Gas takes one of them.
    expect(vile.data.farTargets).toBe(16);
  });

  it('all 25 players have three Inoculated stacks at the first Pungent Blight and take a quarter of it', () => {
    const hits = r.events('damage', { ability: 'pungent_blight' });
    expect(hits).toHaveLength(25);
    // 48,750 to 51,250, × 0.25.
    expect(hits.every((e) => Number(e.data.amount) >= 12187 && Number(e.data.amount) <= 12812)).toBe(true);
    expect(r.summary.maxStacks.inoculated.stacks).toBe(3);
  });

  it('the second tank taunts at nine Gastric Bloat stacks and takes Festergut over', () => {
    const nine = r.events('aura_stack', { aura: 'gastric_bloat', unit: 't1', stacks: 9 })[0];
    const fired = r.events('rule_fired', { rule: 'swap-to-t2', actor: 't2' })[0];
    expect(fired.causes).toEqual([nine.id]);
    const taunt = r.events('taunt', { actor: 't2' })[0];
    expect(taunt.t - nine.t).toBeGreaterThanOrEqual(300);
    expect(taunt.t - nine.t).toBeLessThanOrEqual(600);
    expect(r.events('threat_target').map((e) => e.data.target)).toEqual(['t1', 't2']);
    expect(r.summary.maxStacks.gastric_bloat).toEqual({ unit: 't1', stacks: 9 });
    const next = r.events('cast_start', { spell: 'gastric_bloat' }).find((e) => e.t > taunt.t);
    expect(next?.data.target).toBe('t2');
  });

  it('reports every raid member as a stand-in, with the assumptions and the partial mechanics (spec §6.4)', () => {
    const l = r.summary.limitations;
    expect(l.standIns).toHaveLength(25);
    expect(r.trace.meta.units.filter((u) => u.kind === 'player').every((u) => u.approximate)).toBe(true);
    expect(l.partialMechanics.map((m) => m.key)).toEqual([
      'festergut.gaseous_blight',
      'festergut.gas_spore',
      'festergut.inoculated',
      'festergut.vile_gas',
      'festergut.gastric_explosion',
      'festergut.melee',
      'festergut.emotes',
      'festergut.evade',
    ]);
    const assumed = l.assumptions.map((a) => a.key);
    for (const key of ['core.ai_update_interval_ms', 'core.taunt_range_yd', 'generic_caster.bolt_min', 'generic_healer.heal_min']) expect(assumed, key).toContain(key);
    // Nothing about Festergut himself is an assumption.
    expect(assumed.filter((k) => k.startsWith('festergut.') || k.startsWith('spell.') || k.startsWith('putricide.'))).toEqual([]);
    expect(l.knownServerDifferences).toHaveLength(1);
  });

  it('is deterministic: the same scenario gives a byte-identical canonical trace (spec §11)', () => {
    expect(canonicalStringify(runFestergutScenario('clean-kill').trace)).toBe(canonicalStringify(r.trace));
  });
});
