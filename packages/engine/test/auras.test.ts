import { describe, expect, it } from 'vitest';
import { applyAura, removeAuras } from '../src/auras';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const player = { kind: 'player' as const, role: 'ranged' as const, maxHealth: 5000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 3, maxDurationMs: 20000, sampleIntervalMs: 1000 });
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e6, pos: { x: 0, y: 30 }, speedYdPerSec: 7, combatReach: 5, boundingRadius: 2 });
  sim.addUnit({ ...player, id: 'p1', name: 'P1', pos: { x: 0, y: 0 } });
  sim.addUnit({ ...player, id: 'p2', name: 'P2', pos: { x: 9.5, y: 0 } });
  sim.addUnit({ ...player, id: 'p3', name: 'P3', pos: { x: -9.49, y: 0 } });
  sim.addUnit({ ...player, id: 'p4', name: 'P4', pos: { x: 0, y: -9.51 } });
  sim.catalog.addAura({ id: 'stacker', durationMs: 10000, maxStacks: 3 });
  sim.catalog.addAura({
    id: 'dot',
    durationMs: 3000,
    maxStacks: 1,
    periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'shadow', min: 100, max: 100 }] },
  });
  sim.catalog.addAura({
    id: 'bomb',
    durationMs: 2000,
    maxStacks: 1,
    onExpire: [
      { type: 'area', radius: 8, includeCenter: true, filter: 'players', effects: [{ type: 'damage', school: 'nature', min: 1000, max: 1000 }] },
    ],
  });
  return sim;
}

const events = (sim: Simulation, kind: string) => sim.trace.list().filter((e) => e.kind === kind);

describe('auras', () => {
  it('sets refreshedMs before aura_stack is emitted', () => {
    const sim = newSim();
    const seen: number[] = [];
    sim.subscribe((ev) => {
      if (ev.kind === 'aura_stack') seen.push([...sim.unit('p1').auras.values()][0]!.refreshedMs);
    });
    for (const t of [0, 1500]) sim.at(t, EventClass.SpellHit, () => void applyAura(sim, 'stacker', 'boss', 'p1', []));
    sim.run();
    expect(seen).toEqual([1500]);
  });

  it('stacks up to the maximum and refreshes the duration (A-009)', () => {
    const sim = newSim();
    for (const t of [0, 1000, 2000, 3000]) sim.at(t, EventClass.SpellHit, () => void applyAura(sim, 'stacker', 'boss', 'p1', []));
    sim.run();
    expect(events(sim, 'aura_stack').map((e) => e.data.stacks)).toEqual([2, 3, 3]);
    const removed = events(sim, 'aura_removed')[0];
    expect(removed.t).toBe(13000);
    expect(removed.data.reason).toBe('expired');
  });

  it('ticks before it expires at the same millisecond (A-001)', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'dot', 'boss', 'p1', []));
    sim.run();
    expect(events(sim, 'periodic_tick').map((e) => e.t)).toEqual([1000, 2000, 3000]);
    const at3000 = sim.trace.list().filter((e) => e.t === 3000).map((e) => e.kind);
    expect(at3000).toEqual(['periodic_tick', 'damage', 'aura_removed']);
    expect(sim.unit('p1').health).toBe(4700);
  });

  it('hits exactly the units within the area radius at expiry (boundary test)', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'bomb', 'boss', 'p1', []));
    sim.run();
    const hitIds = events(sim, 'damage').map((e) => e.data.target);
    // p2: edge distance exactly 8 (hit); p3: 7.99 (hit); p4: 8.01 (miss); p1 is the centre.
    expect(hitIds).toEqual(['p1', 'p2', 'p3']);
    const removal = events(sim, 'aura_removed')[0];
    expect(events(sim, 'damage')[0].causes).toEqual([removal.id]);
  });

  it('death at the expiry millisecond removes the aura without its on-expire effect (A-012)', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'bomb', 'boss', 'p1', []));
    sim.at(2000, EventClass.SpellHit, () => void sim.damage('p1', 1e6, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
    sim.run();
    expect(events(sim, 'aura_removed')[0].data.reason).toBe('death');
    expect(events(sim, 'damage').map((e) => e.data.target)).toEqual(['p1']);
  });

  it('removeAuras removes every instance of an aura without on-expire', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      applyAura(sim, 'bomb', 'boss', 'p1', []);
      applyAura(sim, 'bomb', 'p2', 'p1', []);
    });
    sim.at(500, EventClass.SpellHit, () => void removeAuras(sim, 'p1', 'bomb', 'removed', []));
    sim.run();
    expect(events(sim, 'aura_removed').map((e) => e.data.caster)).toEqual(['boss', 'p2']);
    expect(events(sim, 'damage')).toHaveLength(0);
  });

  it('does not apply auras to dead units', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => {
      sim.damage('p1', 1e6, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []);
      expect(applyAura(sim, 'stacker', 'boss', 'p1', [])).toBeNull();
    });
    sim.run();
  });

  it('keeps its tick phase when a refresh revives a stopped tick chain (A-009)', () => {
    const sim = newSim();
    sim.catalog.addAura({
      id: 'phase_dot',
      durationMs: 2500,
      maxStacks: 1,
      periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'shadow', min: 1, max: 1 }] },
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'phase_dot', 'boss', 'p1', []));
    sim.at(2200, EventClass.SpellHit, () => void applyAura(sim, 'phase_dot', 'boss', 'p1', []));
    sim.run();
    expect(events(sim, 'periodic_tick').map((e) => e.t)).toEqual([1000, 2000, 3000, 4000]);
    expect(events(sim, 'aura_removed')[0].t).toBe(4700);
  });

  it('a removed and re-applied aura is not touched by the old instance expiry or ticks', () => {
    const sim = newSim();
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'dot', 'boss', 'p1', []));
    sim.at(500, EventClass.SpellHit, () => void removeAuras(sim, 'p1', 'dot', 'removed', []));
    sim.at(600, EventClass.SpellHit, () => void applyAura(sim, 'dot', 'boss', 'p1', []));
    sim.run();
    expect(events(sim, 'periodic_tick').map((e) => e.t)).toEqual([1600, 2600, 3600]);
    const removed = events(sim, 'aura_removed');
    expect(removed.map((e) => [e.t, e.data.reason])).toEqual([[500, 'removed'], [3600, 'expired']]);
  });

  it('a periodic tick that kills its target ends the aura with reason death and no on-expire', () => {
    const sim = newSim();
    sim.catalog.addAura({
      id: 'lethal',
      durationMs: 5000,
      maxStacks: 1,
      periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'shadow', min: 1e6, max: 1e6 }] },
      onExpire: [{ type: 'damage', school: 'nature', min: 1, max: 1 }],
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'lethal', 'boss', 'p1', []));
    sim.run();
    expect(events(sim, 'periodic_tick').map((e) => e.t)).toEqual([1000]);
    expect(events(sim, 'aura_removed').map((e) => [e.t, e.data.reason])).toEqual([[1000, 'death']]);
    expect(events(sim, 'damage')).toHaveLength(1);
  });

  it('a re-application after expiry starts a fresh tick chain', () => {
    const sim = newSim();
    sim.catalog.addAura({
      id: 'short_dot',
      durationMs: 2500,
      maxStacks: 1,
      periodic: { intervalMs: 1000, effects: [{ type: 'damage', school: 'shadow', min: 1, max: 1 }] },
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'short_dot', 'boss', 'p1', []));
    sim.at(5000, EventClass.SpellHit, () => void applyAura(sim, 'short_dot', 'boss', 'p1', []));
    sim.run();
    expect(events(sim, 'periodic_tick').map((e) => e.t)).toEqual([1000, 2000, 6000, 7000]);
    expect(events(sim, 'aura_removed').map((e) => e.t)).toEqual([2500, 7500]);
  });

  it('a periodic aura whose tick re-applies itself still ticks once per interval', () => {
    const sim = newSim();
    sim.catalog.addAura({
      id: 'self_reapply',
      durationMs: 5000,
      maxStacks: 1,
      periodic: { intervalMs: 1000, effects: [{ type: 'apply_aura', aura: 'self_reapply' }] },
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'self_reapply', 'boss', 'p1', []));
    sim.run();
    const ticks = events(sim, 'periodic_tick').map((e) => e.t);
    expect(ticks).toEqual(Array.from({ length: 20 }, (_, i) => (i + 1) * 1000));
  });

  it('emits nothing after the outcome when an area effect continues past a lethal hit on the last boss', () => {
    const sim = newSim();
    sim.catalog.addAura({
      id: 'doom',
      durationMs: 1000,
      maxStacks: 1,
      onExpire: [
        {
          type: 'area',
          radius: 200,
          includeCenter: true,
          filter: 'all',
          effects: [
            { type: 'damage', school: 'shadow', min: 1e6, max: 1e6 },
            { type: 'apply_aura', aura: 'stacker' },
          ],
        },
      ],
    });
    sim.at(0, EventClass.SpellHit, () => void applyAura(sim, 'doom', 'p1', 'boss', []));
    const outcome = sim.run();
    expect(outcome.kind).toBe('kill');
    const all = sim.trace.list();
    expect(all[all.length - 1].kind).toBe('outcome');
    expect(all.filter((e) => e.kind === 'aura_applied' && e.t >= 1000)).toHaveLength(0);
  });
});
