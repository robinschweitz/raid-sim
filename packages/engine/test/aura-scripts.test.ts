import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import { installCoreRules, startCast } from '../src/casting';
import { damageMultiplier } from '../src/modifiers';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 1, maxDurationMs: 30000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 10, y: 0 } });
  sim.addUnit({ ...body, id: 'p2', name: 'P2', kind: 'player', role: 'ranged', pos: { x: 12, y: 0 } });
  return sim;
}

describe('aura extensions', () => {
  it('a permanent aura has no expiry and is reported with expiresMs null', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'blight', durationMs: null, maxStacks: 1 });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'blight', 'boss', 'boss', []));
    sim.run();
    expect(sim.unit('boss').auras.size).toBe(1);
    expect(sim.trace.list().find((e) => e.kind === 'aura_applied')?.data.expiresMs).toBeNull();
  });

  it('a permanent periodic aura keeps ticking and snapshots stay finite', () => {
    const sim = newSim();
    sim.catalog.addAura({
      id: 'rot',
      durationMs: null,
      maxStacks: 1,
      periodic: { intervalMs: 5000, effects: [{ type: 'damage', school: 'nature', min: 1, max: 1 }] },
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'rot', 'boss', 'p1', []));
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'periodic_tick').length).toBe(6);
  });

  it("stack scope 'unit' stacks across casters", () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'inoculated', durationMs: 20000, maxStacks: 3, stackScope: 'unit' });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'inoculated', 'p1', 'p1', []);
      applyAura(sim, 'inoculated', 'p2', 'p1', []);
    });
    sim.run();
    expect(sim.trace.list().filter((e) => e.kind === 'aura_stack').map((e) => e.data.stacks)).toEqual([2]);
  });

  it('runs afterApply, afterStack and afterRemove hooks with the removal reason', () => {
    const sim = newSim();
    const calls: string[] = [];
    sim.catalog.addAura({ id: 'spore', durationMs: 12000, maxStacks: 2 });
    sim.catalog.addAuraScript('spore', {
      afterApply: (c) => calls.push(`apply:${c.unitId}:${c.stacks}`),
      afterStack: (c) => calls.push(`stack:${c.stacks}:${c.refreshedMs}`),
      afterRemove: (c) => calls.push(`remove:${c.reason}`),
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    sim.at(500, EventClass.SpellHit, () => void applyAura(sim, 'spore', 'boss', 'p1', []));
    sim.at(1000, EventClass.SpellHit, () => void removeAuras(sim, 'p1', 'spore', 'dispelled', []));
    sim.at(2000, EventClass.SpellHit, () => void applyAura(sim, 'spore', 'boss', 'p2', []));
    sim.run();
    expect(calls).toEqual(['apply:p1:1', 'stack:2:500', 'remove:dispelled', 'apply:p2:1', 'remove:expired']);
  });

  it('a spell script runs after the spell hit a target', () => {
    const sim = newSim();
    const hits: string[] = [];
    sim.catalog.addSpell({ id: 'zap', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 100, usableWhileMoving: true, target: 'unit', effects: [{ type: 'damage', school: 'nature', min: 10, max: 10 }] });
    sim.catalog.addSpellScript('zap', { afterHitTarget: (c) => hits.push(`${c.targetId}:${c.sim.unit(c.targetId).health}`) });
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'boss', 'zap', 'p1', []));
    sim.run();
    expect(hits).toEqual(['p1:99990']);
  });

  it('damage modifiers multiply per stack, by school, from caster and target auras', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'inhaled', durationMs: null, maxStacks: 3, modifiers: [{ kind: 'damage_done_pct', pct: 30, perStack: true }] });
    sim.catalog.addAura({ id: 'inoc', durationMs: 20000, maxStacks: 3, modifiers: [{ kind: 'damage_taken_pct', pct: -25, perStack: true, schools: ['nature'] }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'inhaled', 'boss', 'boss', []);
      applyAura(sim, 'inhaled', 'boss', 'boss', []);
      applyAura(sim, 'inoc', 'p1', 'p1', []);
    });
    sim.at(10, EventClass.SpellHit, () => {
      expect(damageMultiplier(sim, 'boss', 'p1', 'nature')).toBeCloseTo((1 + 0.6) * (1 - 0.25), 10);
      expect(damageMultiplier(sim, 'boss', 'p1', 'physical')).toBeCloseTo(1.6, 10);
      expect(damageMultiplier(sim, 'p2', 'p1', 'nature')).toBeCloseTo(0.75, 10);
    });
    sim.run();
  });
  it('removeAuras survives a hook that removes the same aura again', () => {
    const sim = newSim();
    const removed: string[] = [];
    sim.catalog.addAura({ id: 'spore', durationMs: 12000, maxStacks: 1 });
    sim.catalog.addAuraScript('spore', {
      afterRemove: (c) => {
        removed.push(c.casterId);
        removeAuras(c.sim, c.unitId, 'spore', 'removed', c.causes);
      },
    });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'spore', 'p2', 'p1', []);
      applyAura(sim, 'spore', 'boss', 'p1', []);
    });
    sim.at(10, EventClass.SpellHit, () => {
      removeAuras(sim, 'p1', 'spore', 'removed', []);
      expect(sim.unit('p1').auras.size).toBe(0);
    });
    sim.run();
    expect([...removed].sort()).toEqual(['boss', 'p2']);
    expect(sim.trace.list().filter((e) => e.kind === 'aura_removed').length).toBe(2);
  });

  it('modifier terms never go below zero, so two negative factors cannot turn positive', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'weak', durationMs: null, maxStacks: 1, modifiers: [{ kind: 'damage_done_pct', pct: -150, perStack: false }] });
    sim.catalog.addAura({ id: 'ward', durationMs: null, maxStacks: 4, modifiers: [{ kind: 'damage_taken_pct', pct: -30, perStack: true }] });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'weak', 'boss', 'boss', []);
      for (let i = 0; i < 4; i++) applyAura(sim, 'ward', 'p1', 'p1', []);
    });
    sim.at(10, EventClass.SpellHit, () => {
      expect(damageMultiplier(sim, 'boss', 'p1', 'nature')).toBe(0);
    });
    sim.run();
  });

  it('hooks report previousStacks, including a re-apply at max stacks', () => {
    const sim = newSim();
    const calls: string[] = [];
    sim.catalog.addAura({ id: 'spore', durationMs: 12000, maxStacks: 2 });
    sim.catalog.addAuraScript('spore', {
      afterApply: (c) => calls.push(`apply:${c.previousStacks}>${c.stacks}`),
      afterStack: (c) => calls.push(`stack:${c.previousStacks}>${c.stacks}`),
    });
    sim.at(0, EventClass.SpellHit, () => {
      for (let i = 0; i < 3; i++) applyAura(sim, 'spore', 'boss', 'p1', []);
    });
    sim.run();
    expect(calls).toEqual(['apply:0>1', 'stack:1>2', 'stack:2>2']);
  });

  it('afterRemove does not run when the holder was killed by the on-expire effect', () => {
    const sim = newSim();
    const calls: string[] = [];
    sim.catalog.addAura({ id: 'bomb', durationMs: 1000, maxStacks: 1, onExpire: [{ type: 'damage', school: 'nature', min: 1e6, max: 1e6 }] });
    sim.catalog.addAuraScript('bomb', { afterRemove: (c) => calls.push(c.reason) });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'bomb', 'boss', 'p1', []));
    sim.run();
    expect(sim.unit('p1').alive).toBe(false);
    expect(calls).toEqual([]);
  });

  it('afterHitTarget is skipped when the spell effects kill the target', () => {
    const sim = newSim();
    const hits: string[] = [];
    sim.catalog.addSpell({ id: 'smite', castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 100, usableWhileMoving: true, target: 'unit', effects: [{ type: 'damage', school: 'nature', min: 1e9, max: 1e9 }] });
    sim.catalog.addSpellScript('smite', { afterHitTarget: (c) => hits.push(c.targetId) });
    sim.at(0, EventClass.Decision, () => void startCast(sim, 'boss', 'smite', 'p1', []));
    sim.run();
    expect(sim.unit('p1').alive).toBe(false);
    expect(hits).toEqual([]);
  });

  it('a hook that kills the holder prevents later removal hooks (death removes the other instances silently)', () => {
    // removeAuras on an already-dead holder cannot happen: death removes auras first, without hooks.
    const sim = newSim();
    const calls: string[] = [];
    sim.catalog.addAura({ id: 'spore', durationMs: 12000, maxStacks: 1 });
    sim.catalog.addAuraScript('spore', {
      afterRemove: (c) => {
        calls.push(c.casterId);
        c.sim.damage(c.unitId, 1e9, { sourceId: 'boss', ability: 'x', school: 'nature' }, c.causes);
      },
    });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'spore', 'p2', 'p1', []);
      applyAura(sim, 'spore', 'boss', 'p1', []);
    });
    sim.at(10, EventClass.SpellHit, () => void removeAuras(sim, 'p1', 'spore', 'removed', []));
    sim.run();
    expect(sim.unit('p1').alive).toBe(false);
    expect(calls).toHaveLength(1);
    const reasons = sim.trace.list().filter((e) => e.kind === 'aura_removed').map((e) => e.data.reason);
    expect(reasons).toEqual(['removed', 'death']);
  });
});
