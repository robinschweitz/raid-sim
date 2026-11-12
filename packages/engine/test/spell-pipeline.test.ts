import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import type { SpellDef } from '../src/catalog';
import { installCoreRules, startCast } from '../src/casting';
import { applyEffects } from '../src/effects';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const instant = { castTimeMs: 0, gcdMs: 0, cooldownMs: 0, usableWhileMoving: true } as const;

function newSim() {
  const sim = new Simulation({ seed: 4, maxDurationMs: 6000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.addUnit({ ...body, id: 'p2', name: 'P2', kind: 'player', role: 'ranged', pos: { x: 6, y: 0 } });
  sim.addUnit({ ...body, id: 'p3', name: 'P3', kind: 'player', role: 'ranged', pos: { x: 40, y: 0 } });
  sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_taken_pct', pct: -50, perStack: false }] });
  sim.catalog.addAura({ id: 'mark', durationMs: 10000, maxStacks: 1 });
  return sim;
}

const NOVA: SpellDef = {
  ...instant,
  id: 'nova',
  rangeYd: 0,
  target: 'self',
  effects: [
    { type: 'area', radius: 10, center: 'caster', relation: 'enemy', effects: [{ type: 'damage', school: 'shadow', min: 1000, max: 1000 }] },
    { type: 'area', radius: 10, center: 'caster', relation: 'enemy', effects: [{ type: 'apply_aura', aura: 'mark' }] },
    { type: 'on_caster', effects: [{ type: 'script' }] },
  ],
};

describe('spell launch and hit (A-024)', () => {
  it('fixes damage at launch: a hit hook that removes a modifier does not change that hit', () => {
    const sim = newSim();
    sim.catalog.addSpell(NOVA);
    sim.catalog.addSpellScript('nova', {
      onEffectHitTarget: (c) => {
        if (c.effectIndex === 0) removeAuras(c.sim, c.targetId, 'ward', 'removed', c.causes);
      },
    });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'ward', 'p1', 'p1', []);
      startCast(sim, 'boss', 'nova', 'boss', []);
    });
    sim.run();
    const dmg = sim.trace.list().filter((e) => e.kind === 'damage').map((e) => [e.data.target, e.data.amount]);
    expect(dmg).toEqual([['p1', 500], ['p2', 1000]]);
    expect([...sim.unit('p1').auras.keys()]).toEqual(['mark|boss']);
  });

  it('hits each unit in turn: spell_hit, its auras, the hooks in effect order, then the damage', () => {
    const sim = newSim();
    const hooks: string[] = [];
    sim.catalog.addSpell(NOVA);
    sim.catalog.addSpellScript('nova', {
      onEffectHitTarget: (c) => void hooks.push(`${c.targetId}:${c.effectIndex}`),
      afterHitTarget: (c) => void hooks.push(`${c.targetId}:after`),
    });
    sim.at(0, EventClass.SpellHit, () => void startCast(sim, 'boss', 'nova', 'boss', []));
    sim.run();
    expect(hooks).toEqual(['p1:0', 'p1:1', 'p1:after', 'p2:0', 'p2:1', 'p2:after', 'boss:2', 'boss:after']);
    const list = sim.trace.list();
    const afterSuccess = list.slice(list.findIndex((e) => e.kind === 'cast_success') + 1).filter((e) => e.t === 0);
    expect(afterSuccess.map((e) => `${e.kind}:${e.data.target ?? e.data.unit}`)).toEqual([
      'spell_hit:p1',
      'aura_applied:p1',
      'damage:p1',
      'spell_hit:p2',
      'aura_applied:p2',
      'damage:p2',
      'spell_hit:boss',
    ]);
  });

  it('runs the hook before the default handler of its effect', () => {
    const sim = newSim();
    const seen: number[] = [];
    sim.catalog.addSpell({ ...instant, id: 'cleanse', rangeYd: 30, target: 'unit', effects: [{ type: 'remove_aura', aura: 'mark' }] });
    sim.catalog.addSpellScript('cleanse', { onEffectHitTarget: (c) => void seen.push(c.sim.unit(c.targetId).auras.size) });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'mark', 'boss', 'p1', []);
      startCast(sim, 'boss', 'cleanse', 'p1', []);
    });
    sim.run();
    expect(seen).toEqual([1]);
    expect(sim.unit('p1').auras.size).toBe(0);
  });

  it('a travelling spell keeps the damage fixed at launch', () => {
    const run = (wardAt: number | null, removeAt: number | null) => {
      const sim = newSim();
      sim.catalog.addSpell({ ...instant, id: 'arrow', rangeYd: 50, target: 'unit', travelSpeedYdPerSec: 10, effects: [{ type: 'damage', school: 'physical', min: 1000, max: 1000 }] });
      if (wardAt !== null) sim.at(wardAt, EventClass.SpellHit, () => void applyAura(sim, 'ward', 'p3', 'p3', []));
      if (removeAt !== null) sim.at(removeAt, EventClass.SpellHit, () => void removeAuras(sim, 'p3', 'ward', 'removed', []));
      sim.at(0, EventClass.Decision, () => void startCast(sim, 'boss', 'arrow', 'p3', []));
      sim.run();
      return sim.trace.list().filter((e) => e.kind === 'damage').map((e) => [e.t, e.data.amount]);
    };
    expect(run(100, null)).toEqual([[4000, 1000]]);
    expect(run(0, 100)).toEqual([[4000, 500]]);
  });

  it('on_caster effects reach the caster of a spell aimed at another unit', () => {
    const sim = newSim();
    sim.catalog.addSpell({
      ...instant,
      id: 'leech',
      rangeYd: 30,
      target: 'unit',
      effects: [
        { type: 'damage', school: 'shadow', min: 100, max: 100 },
        { type: 'on_caster', effects: [{ type: 'apply_aura', aura: 'mark' }] },
      ],
    });
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'boss', 'leech', 'p1', []));
    sim.run();
    expect(sim.unit('boss').auras.has('mark|boss')).toBe(true);
    expect(sim.trace.list().filter((e) => e.kind === 'spell_hit').map((e) => e.data.target)).toEqual(['p1', 'boss']);
  });

  it('on_caster effects reached through an area (an area-applied aura tick) do not count as area damage', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'avoid', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'aoe_damage_taken_pct', pct: -50, perStack: false }] });
    const self = { type: 'on_caster', effects: [{ type: 'damage', school: 'shadow', min: 1000, max: 1000 }] } as const;
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'avoid', 'p1', 'p1', []);
      applyEffects(sim, [self], { casterId: 'p1', targetId: 'p2', ability: 'tick', causes: [], viaArea: true });
    });
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'damage').map((e) => [e.data.target, e.data.amount])).toEqual([['p1', 1000]]);
  });
});
