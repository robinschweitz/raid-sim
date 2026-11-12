import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { makeBossContext } from '../src/boss';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 14, maxDurationMs: 3000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.addUnit({ ...body, id: 'p2', name: 'P2', kind: 'player', role: 'ranged', pos: { x: 6, y: 0 } });
  sim.catalog.addSpell({
    id: 'splash',
    castTimeMs: 0,
    gcdMs: 0,
    cooldownMs: 0,
    rangeYd: 0,
    usableWhileMoving: true,
    target: 'self',
    effects: [{ type: 'area', radius: 8, center: 'caster', relation: 'ally', excludeCaster: true, effects: [{ type: 'damage', school: 'shadow', min: 100, max: 100 }] }],
  });
  return sim;
}

const starts = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'cast_start');

describe('casting as another unit (A-020)', () => {
  it('a boss script makes another unit cast; the trace names the original caster', () => {
    const sim = newSim();
    sim.at(0, EventClass.AiUpdate, () => void makeBossContext(sim, 'boss').castAs('p1', 'splash', 'p1', [], { triggered: true, originalCasterId: 'boss' }));
    sim.run();
    expect(starts(sim)[0].data).toMatchObject({ caster: 'p1', target: 'p1', triggered: true, originalCaster: 'boss' });
    expect(sim.trace.list().find((e) => e.kind === 'damage')?.data).toMatchObject({ target: 'p2', source: 'boss', amount: 100 });
  });

  it('an aura hook makes the holder cast', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'spore', durationMs: 1000, maxStacks: 1 });
    sim.catalog.addAuraScript('spore', {
      afterRemove: (c) => void startCast(c.sim, c.unitId, 'splash', c.unitId, c.causes, { triggered: true, originalCasterId: c.casterId }),
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    sim.run();
    const removed = sim.trace.list().find((e) => e.kind === 'aura_removed')!;
    const start = starts(sim)[0];
    expect(start.t).toBe(1000);
    expect(start.causes).toEqual([removed.id]);
    expect(start.data).toMatchObject({ caster: 'p1', originalCaster: 'boss' });
  });

  it("a triggered cast by a player leaves the player's own cast and GCD alone", () => {
    const sim = newSim();
    sim.catalog.addSpell({ id: 'bolt', castTimeMs: 2000, gcdMs: 1500, cooldownMs: 0, rangeYd: 40, usableWhileMoving: false, target: 'unit', effects: [{ type: 'damage', school: 'fire', min: 1, max: 1 }] });
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'p1', 'bolt', 'boss', []));
    sim.at(500, EventClass.AiUpdate, () => {
      makeBossContext(sim, 'boss').castAs('p1', 'splash', 'p1', [], { triggered: true, originalCasterId: 'boss' });
      expect(sim.unit('p1').cast?.spellId).toBe('bolt');
      expect(sim.unit('p1').gcdUntilMs).toBe(1500);
    });
    sim.run();
    expect(sim.trace.list().find((e) => e.kind === 'cast_success' && e.data.spell === 'bolt')?.t).toBe(2000);
  });

  it('records no original caster unless the script passes one (Spell.cpp 661-663)', () => {
    const sim = newSim();
    sim.at(0, EventClass.AiUpdate, () => void makeBossContext(sim, 'boss').castAs('p1', 'splash', 'p1', [], { triggered: true }));
    sim.run();
    expect(starts(sim)[0].data).not.toHaveProperty('originalCaster');
    expect(sim.trace.list().find((e) => e.kind === 'damage')?.data).toMatchObject({ target: 'p2', source: 'p1' });
  });

  it('rejects an unknown original caster', () => {
    const sim = newSim();
    expect(() => startCast(sim, 'p1', 'splash', 'p1', [], { triggered: true, originalCasterId: 'ghost' })).toThrow(/unknown unit ghost/);
  });
});

describe('the original caster owns damage, bonuses and auras (A-020)', () => {
  const done = { id: 'might', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_done_pct', pct: 50, perStack: false }] } as const;
  const viaBoss = (sim: Simulation, spell: string, target: string, caster = 'p1') =>
    sim.at(0, EventClass.AiUpdate, () => void makeBossContext(sim, 'boss').castAs(caster, spell, target, [], { triggered: true, originalCasterId: 'boss' }));
  const damages = (sim: Simulation) => sim.trace.list().filter((e) => e.kind === 'damage').map((e) => e.data);

  it('uses the original caster damage-done factor and the creature-AoE rule, not the casting unit ones', () => {
    const sim = newSim();
    sim.catalog.addAura(done);
    sim.catalog.addAura({ id: 'shield', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'creature_aoe_damage_taken_pct', pct: -50, perStack: false }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'might', 'boss', 'boss', []);
      applyAura(sim, 'shield', 'p2', 'p2', []);
    });
    viaBoss(sim, 'splash', 'p1');
    sim.run();
    // 100 x 1.5 (boss done factor) x 0.5 (creature AoE reduction, because the owner is a creature).
    expect(damages(sim)).toEqual([expect.objectContaining({ target: 'p2', source: 'boss', amount: 75 })]);
  });

  it('without an original caster the casting unit stays the owner', () => {
    const sim = newSim();
    sim.catalog.addAura(done);
    sim.catalog.addAura({ id: 'shield', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'creature_aoe_damage_taken_pct', pct: -50, perStack: false }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'might', 'boss', 'boss', []);
      applyAura(sim, 'shield', 'p2', 'p2', []);
      startCast(sim, 'p1', 'splash', 'p1', [], { triggered: true });
    });
    sim.run();
    expect(damages(sim)).toEqual([expect.objectContaining({ target: 'p2', source: 'p1', amount: 100 })]);
  });

  it('keeps the casting unit for the area relation and the player cap', () => {
    const sim = newSim();
    for (let i = 0; i < 10; i++) sim.addUnit({ ...body, id: `q${String(i).padStart(2, '0')}`, name: 'Q', kind: 'player', role: 'ranged', pos: { x: 4, y: 1 + i / 10 } });
    sim.catalog.addSpell({
      id: 'wide', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: true, target: 'self',
      effects: [{ type: 'area', radius: 30, center: 'caster', relation: 'ally', excludeCaster: true, effects: [{ type: 'damage', school: 'shadow', min: 100, max: 100 }] }],
    });
    viaBoss(sim, 'wide', 'p1');
    sim.run();
    // The relation is the player one (allies are the 11 other players, not the boss) and p1 is a player: 11 units hit, so 100 x 10 / 11.
    const hit = damages(sim);
    expect(hit.map((d) => d.target)).not.toContain('boss');
    expect(hit).toHaveLength(11);
    expect(hit.every((d) => d.amount === Math.trunc((100 * 10) / 11) && d.source === 'boss')).toBe(true);
  });

  it('applies auras with the original caster as their caster, also for fixed periodic amounts', () => {
    const sim = newSim();
    sim.catalog.addAura(done);
    sim.catalog.addAura({ id: 'rot', durationMs: 2000, maxStacks: 1, periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'shadow', min: 100, max: 100 }] } });
    sim.catalog.addSpell({ id: 'rotten', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: true, target: 'self', effects: [{ type: 'on_caster', effects: [{ type: 'apply_aura', aura: 'rot' }] }] });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'might', 'boss', 'boss', []));
    viaBoss(sim, 'rotten', 'p1');
    sim.run();
    expect([...sim.unit('p1').auras.keys()]).toEqual([]);
    const applied = sim.trace.list().find((e) => e.kind === 'aura_applied' && e.data.aura === 'rot')!;
    expect(applied.data).toMatchObject({ unit: 'p1', caster: 'boss' });
    expect(damages(sim)).toEqual([expect.objectContaining({ target: 'p1', source: 'boss', amount: 150 }), expect.objectContaining({ amount: 150 })]);
  });

  it('two casting units casting for the same owner share one aura instance (Spell.cpp 3253)', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'brand', durationMs: 5000, maxStacks: 2 });
    sim.catalog.addSpell({ id: 'brand_it', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 100, usableWhileMoving: true, target: 'unit', effects: [{ type: 'apply_aura', aura: 'brand' }] });
    viaBoss(sim, 'brand_it', 'p2', 'p1');
    sim.at(0, EventClass.AiUpdate, () => void makeBossContext(sim, 'boss').castAs('boss', 'brand_it', 'p2', [], { triggered: true, originalCasterId: 'boss' }));
    sim.run();
    const auras = [...sim.unit('p2').auras.values()];
    expect(auras).toHaveLength(1);
    expect(auras[0]).toMatchObject({ auraId: 'brand', casterId: 'boss', stacks: 2 });
  });

  it('the on-expire effects of an aura owned through an original caster use that owner', () => {
    const sim = newSim();
    sim.catalog.addAura(done);
    sim.catalog.addAura({ id: 'fuse', durationMs: 1000, maxStacks: 1, onExpire: [{ type: 'damage', school: 'shadow', min: 100, max: 100 }] });
    sim.catalog.addSpell({ id: 'light', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: true, target: 'self', effects: [{ type: 'on_caster', effects: [{ type: 'apply_aura', aura: 'fuse' }] }] });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'might', 'boss', 'boss', []));
    viaBoss(sim, 'light', 'p1');
    sim.run();
    expect(damages(sim)).toEqual([expect.objectContaining({ target: 'p1', source: 'boss', amount: 150 })]);
  });

  it('heals come from the original caster', () => {
    const sim = newSim();
    sim.catalog.addSpell({ id: 'mend', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 0, usableWhileMoving: true, target: 'self', effects: [{ type: 'heal', min: 10, max: 10 }] });
    sim.at(0, EventClass.SpellHit, () => void sim.damage('p1', 50, { sourceId: 'boss', ability: 'x', school: 'physical' }, []));
    // The heal runs after the damage (t=1), whatever the order of event classes.
    sim.at(1, EventClass.AiUpdate, () => void makeBossContext(sim, 'boss').castAs('p1', 'mend', 'p1', [], { triggered: true, originalCasterId: 'boss' }));
    sim.run();
    expect(sim.trace.list().find((e) => e.kind === 'heal')?.data).toMatchObject({ target: 'p1', source: 'boss' });
  });

  it('a dead original caster still owns the spell with its death-persistent factors', () => {
    const sim = newSim();
    sim.catalog.addAura({ ...done, deathPersistent: true });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'might', 'p2', 'p2', []);
      sim.damage('p2', 1e9, { sourceId: 'boss', ability: 'x', school: 'physical' }, []);
    });
    sim.catalog.addSpell({ id: 'tick', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 100, usableWhileMoving: true, target: 'unit', effects: [{ type: 'damage', school: 'shadow', min: 100, max: 100 }] });
    sim.at(10, EventClass.SpellHit, () => void startCast(sim, 'boss', 'tick', 'p1', [], { triggered: true, originalCasterId: 'p2' }));
    sim.run();
    expect(damages(sim).at(-1)).toMatchObject({ target: 'p1', source: 'p2', amount: 150 });
  });
});
