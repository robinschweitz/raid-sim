import { causeChain } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { CONTENT_TEXT_EN } from '../../src/index';
import { runFestergutScenario, scenarioTextKeys } from './scenario';

describe('scenario: the tank swap comes too late (spec §10.3)', () => {
  const r = runFestergutScenario('late-tank-swap');

  it('every observation passes', () => {
    expect(r.summary.observations.filter((o) => !o.pass)).toEqual([]);
    expect(r.summary.observations).toHaveLength(4);
    expect(r.trace.meta.mistakes).toEqual(['{"atLeast":10,"rule":"swap-to-t2","type":"set_stack_threshold"}']);
    for (const key of scenarioTextKeys('late-tank-swap')) expect(CONTENT_TEXT_EN[key], key).toBeTruthy();
  });

  it('nobody taunts at nine stacks; the tenth stack is Gastric Explosion', () => {
    const nine = r.events('aura_stack', { aura: 'gastric_bloat', unit: 't1', stacks: 9 })[0];
    const ten = r.events('aura_stack', { aura: 'gastric_bloat', unit: 't1', stacks: 10 })[0];
    expect(r.events('taunt').filter((e) => e.t < ten.t)).toEqual([]);
    expect(ten.t - nine.t).toBeGreaterThanOrEqual(15000);
    const explosion = r.events('cast_start', { spell: 'gastric_explosion' })[0];
    expect(explosion).toMatchObject({ t: ten.t, data: { caster: 't1', triggered: true } });
    expect(r.summary.maxStacks.gastric_bloat).toEqual({ unit: 't1', stacks: 10 });
  });

  it('the cause chain of the death leads back to the Gastric Bloat cast, and the late rule hangs on the same stack', () => {
    const death = r.events('death', { unit: 't1' })[0];
    const chain = causeChain(r.trace, death).map((id) => r.trace.events.find((e) => e.id === id)!);
    expect(chain.map((e) => `${e.kind}:${e.data.spell ?? e.data.ability ?? e.data.event}`)).toEqual([
      'damage:gastric_explosion',
      'spell_hit:gastric_explosion',
      'cast_success:gastric_explosion',
      'cast_start:gastric_explosion',
      'spell_hit:gastric_bloat',
      'cast_success:gastric_bloat',
      'cast_start:gastric_bloat',
      'ai_event:gastric_bloat',
    ]);
    const ten = r.events('aura_stack', { aura: 'gastric_bloat', unit: 't1', stacks: 10 })[0];
    expect(chain.map((e) => e.id)).toContain(ten.causes[0]);
    const fired = r.events('rule_fired', { rule: 'swap-to-t2' })[0];
    expect(fired.causes).toEqual([ten.id]);
    expect(r.summary.deaths.find((d) => d.unit === 't1')?.killingBlow).toMatchObject({ ability: 'gastric_explosion', source: 't1' });
  });

  it('the explosion hits the melee group within 10 yd of the tank, not the players at their ranged spots', () => {
    const explosion = r.events('cast_start', { spell: 'gastric_explosion' })[0];
    const hit = r.events('damage', { ability: 'gastric_explosion' }).filter((e) => e.t === explosion.t).map((e) => String(e.data.target));
    for (const id of ['m1', 'm2', 'm3', 'm4', 't2', 'h1', 'h2']) expect(hit, id).toContain(id);
    expect(hit.every((id) => r.events('damage', { ability: 'gastric_explosion', target: id })[0].data.source === 't1')).toBe(true);
  });
});
