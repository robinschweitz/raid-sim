import { describe, expect, it } from 'vitest';
import { applyAura } from '../src/auras';
import { installCoreRules, startCast } from '../src/casting';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 100000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };
const instant = { castTimeMs: 0, gcdMs: 0, cooldownMs: 0, rangeYd: 100, usableWhileMoving: true } as const;

function newSim() {
  const sim = new Simulation({ seed: 12, maxDurationMs: 5000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e7, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'p1', name: 'P1', kind: 'player', role: 'ranged', pos: { x: 5, y: 0 } });
  sim.addUnit({ ...body, id: 'p2', name: 'P2', kind: 'player', role: 'ranged', pos: { x: 6, y: 0 } });
  sim.catalog.addAura({ id: 'spores', durationMs: 6000, maxStacks: 1 });
  sim.catalog.addAura({ id: 'mark', durationMs: 5000, maxStacks: 1 });
  sim.catalog.addAura({ id: 'inoculated', durationMs: 120000, maxStacks: 3, stackScope: 'unit', deathPersistent: true });
  return sim;
}

const kill = (sim: Simulation, id: string) => sim.damage(id, 1e9, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []);

describe('auras and death (A-012)', () => {
  it('death runs afterRemove with reason death, after the death event', () => {
    const sim = newSim();
    const calls: string[] = [];
    sim.catalog.addAuraScript('spores', { afterRemove: (c) => void calls.push(`${c.reason}:${c.sim.unit(c.unitId).alive}`) });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'boss', 'p1', []));
    sim.at(100, EventClass.SpellHit, () => void kill(sim, 'p1'));
    sim.run();
    expect(calls).toEqual(['death:false']);
    const at100 = sim.trace.list().filter((e) => e.t === 100).map((e) => e.kind);
    expect(at100).toEqual(['damage', 'death', 'aura_removed']);
  });

  it('a death-persistent aura stays on a dead unit', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'inoculated', 'p1', 'p1', []);
      applyAura(sim, 'mark', 'boss', 'p1', []);
    });
    sim.at(100, EventClass.SpellHit, () => void kill(sim, 'p1'));
    sim.run();
    expect([...sim.unit('p1').auras.values()].map((a) => a.auraId)).toEqual(['inoculated']);
    const last = sim.trace.build({} as never).snapshots.at(-1)!;
    expect(last.units.find((u) => u.id === 'p1')?.auras).toEqual([['inoculated', 1]]);
  });

  it('a dead unit casts a spell that allows it and gains a death-persistent aura (Inoculated after Blighted Spores)', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...instant, id: 'inoculate', target: 'self', allowDeadCaster: true, allowDeadTarget: true, effects: [{ type: 'apply_aura', aura: 'inoculated' }] });
    sim.catalog.addAuraScript('spores', {
      afterRemove: (c) => void startCast(c.sim, c.unitId, 'inoculate', c.unitId, c.causes, { triggered: true }),
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'spores', 'boss', 'p1', []));
    sim.at(100, EventClass.SpellHit, () => void kill(sim, 'p1'));
    sim.run();
    expect(sim.unit('p1').alive).toBe(false);
    expect(sim.unit('p1').auras.get('inoculated|*')?.stacks).toBe(1);
    expect(sim.trace.list().find((e) => e.kind === 'cast_start')?.data).toMatchObject({ caster: 'p1', spell: 'inoculate', target: 'p1' });
  });

  it('without the flags a dead caster or target fails, and a dead unit only takes death-persistent auras', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...instant, id: 'plain', target: 'self', effects: [{ type: 'apply_aura', aura: 'inoculated' }] });
    sim.catalog.addSpell({ ...instant, id: 'zap', target: 'unit', effects: [{ type: 'damage', school: 'shadow', min: 1, max: 1 }] });
    sim.at(0, EventClass.SpellHit, () => {
      kill(sim, 'p1');
      expect(startCast(sim, 'p1', 'plain', 'p1', [], { triggered: true })).toMatchObject({ ok: false, reason: 'dead' });
      expect(startCast(sim, 'boss', 'zap', 'p1', [], { triggered: true })).toMatchObject({ ok: false, reason: 'target_dead' });
      expect(applyAura(sim, 'mark', 'boss', 'p1', [], { allowDeadTarget: true })).toBeNull();
      expect(applyAura(sim, 'inoculated', 'p1', 'p1', [])).toBeNull();
      expect(applyAura(sim, 'inoculated', 'p1', 'p1', [], { allowDeadTarget: true })).not.toBeNull();
    });
    sim.run();
  });
  it('a hook during death processing that decides the fight leaves no events after the outcome', () => {
    const sim = newSim();
    const calls: string[] = [];
    sim.catalog.addAura({ id: 'a', durationMs: 6000, maxStacks: 1 });
    sim.catalog.addAuraScript('a', {
      afterRemove: (c) => {
        calls.push('a');
        if (c.unitId === 'p1') kill(c.sim, 'p2');
      },
    });
    sim.catalog.addAuraScript('mark', { afterRemove: () => void calls.push('mark') });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'a', 'boss', 'p1', []);
      applyAura(sim, 'mark', 'boss', 'p1', []);
    });
    sim.at(100, EventClass.SpellHit, () => void kill(sim, 'p1'));
    expect(sim.run().kind).toBe('wipe');
    const events = sim.trace.list();
    expect(events.at(-1)?.kind).toBe('outcome');
    expect(events.filter((e) => e.kind === 'outcome')).toHaveLength(1);
    expect(calls).toEqual(['a']);
    expect(sim.unit('p1').auras.size).toBe(0);
  });

  it('afterApply and afterStack run on a dead holder when a death-persistent aura lands there', () => {
    const sim = newSim();
    const calls: string[] = [];
    sim.catalog.addAuraScript('inoculated', {
      afterApply: (c) => void calls.push(`apply:${c.sim.unit(c.unitId).alive}`),
      afterStack: (c) => void calls.push(`stack:${c.stacks}`),
    });
    sim.at(0, EventClass.SpellHit, () => {
      kill(sim, 'p1');
      applyAura(sim, 'inoculated', 'p1', 'p1', [], { allowDeadTarget: true });
      applyAura(sim, 'inoculated', 'p1', 'p1', [], { allowDeadTarget: true });
    });
    sim.run();
    expect(calls).toEqual(['apply:false', 'stack:2']);
  });

  it('a dead caster with allowDeadCaster starts and finishes a timed, non-triggered cast', () => {
    const sim = newSim();
    sim.catalog.addSpell({ ...instant, id: 'last_word', castTimeMs: 500, target: 'self', allowDeadCaster: true, allowDeadTarget: true, effects: [{ type: 'apply_aura', aura: 'inoculated' }] });
    sim.at(0, EventClass.SpellHit, () => {
      kill(sim, 'p1');
      expect(startCast(sim, 'p1', 'last_word', 'p1', [])).toMatchObject({ ok: true });
    });
    sim.run();
    const done = sim.trace.list().find((e) => e.kind === 'cast_success');
    expect(done?.t).toBe(500);
    expect(sim.unit('p1').auras.get('inoculated|*')?.stacks).toBe(1);
  });

  it('kills from death hooks nest in event order', () => {
    const sim = newSim();
    sim.addUnit({ ...body, id: 'p3', name: 'P3', kind: 'player', role: 'ranged', pos: { x: 7, y: 0 } });
    sim.catalog.addAura({ id: 'a', durationMs: 6000, maxStacks: 1 });
    sim.catalog.addAuraScript('a', { afterRemove: (c) => void (c.unitId === 'p1' && kill(c.sim, 'p2')) });
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'a', 'boss', 'p1', []);
      applyAura(sim, 'mark', 'boss', 'p2', []);
    });
    sim.at(100, EventClass.SpellHit, () => void kill(sim, 'p1'));
    sim.run();
    const at100 = sim.trace.list().filter((e) => e.t === 100).map((e) => `${e.kind}:${e.data.target ?? e.data.unit}`);
    expect(at100).toEqual(['damage:p1', 'death:p1', 'aura_removed:p1', 'damage:p2', 'death:p2', 'aura_removed:p2']);
  });

  it('a death-persistent periodic aura keeps ticking on a corpse without effect', () => {
    const sim = newSim();
    sim.catalog.addAura({ id: 'rot', durationMs: 3000, maxStacks: 1, deathPersistent: true, periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'shadow', min: 10, max: 10 }] } });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'rot', 'boss', 'p1', []));
    sim.at(500, EventClass.SpellHit, () => void kill(sim, 'p1'));
    sim.run();
    // The tick at 3000 comes before the expiry at 3000 (PeriodicTick class precedes AuraExpiry), so the last tick still runs.
    const list = sim.trace.list();
    expect(list.filter((e) => e.kind === 'periodic_tick').map((e) => e.t)).toEqual([1000, 2000, 3000]);
    expect(list.filter((e) => e.kind === 'damage')).toHaveLength(1);
  });
});
