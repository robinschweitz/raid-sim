import { describe, expect, it } from 'vitest';
import type { AreaEffect } from '../src/catalog';
import { applyEffects } from '../src/effects';
import { EventClass } from '../src/queue';
import { Simulation } from '../src/sim';

const body = { maxHealth: 1000000, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 };

function newSim() {
  const sim = new Simulation({ seed: 1, maxDurationMs: 1000, sampleIntervalMs: 1000 });
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', combatReach: 8, pos: { x: 0, y: 0 } });
  sim.addUnit({ ...body, id: 'add', name: 'Add', kind: 'creature', role: 'add', combatReach: 3, pos: { x: 0, y: 5 } });
  sim.addUnit({ ...body, id: 'p_at', name: 'At', kind: 'player', role: 'ranged', pos: { x: 8, y: 0 } });
  sim.addUnit({ ...body, id: 'p_out', name: 'Out', kind: 'player', role: 'ranged', pos: { x: -8.01, y: 0 } });
  sim.addUnit({ ...body, id: 'p_in', name: 'In', kind: 'player', role: 'ranged', pos: { x: 0, y: -7.99 } });
  return sim;
}

function hits(area: Omit<AreaEffect, 'type' | 'effects'>, casterId: string, targetId = casterId): string[] {
  const sim = newSim();
  sim.at(0, EventClass.SpellHit, () =>
    applyEffects(sim, [{ type: 'area', ...area, effects: [{ type: 'damage', school: 'shadow', min: 1, max: 1 }] }], { casterId, targetId, ability: 'test', causes: [] }),
  );
  sim.run();
  return sim.trace.list().filter((e) => e.kind === 'damage').map((e) => e.data.target as string);
}

describe('area targets (A-003)', () => {
  it('uses the centre distance without the target reach: exactly at the radius is inside', () => {
    // p_at 8.00 (in), p_in 7.99 (in), p_out 8.01 (out); with the old edge rule p_out (6.51 to its edge) was hit.
    expect(hits({ radius: 8, center: 'caster', relation: 'enemy' }, 'boss')).toEqual(['p_at', 'p_in']);
  });

  it('selects by relation to the caster, players only, and can exclude the caster', () => {
    expect(hits({ radius: 8, center: 'caster', relation: 'ally' }, 'boss')).toEqual(['add', 'boss']);
    expect(hits({ radius: 8, center: 'caster', relation: 'ally', excludeCaster: true }, 'boss')).toEqual(['add']);
    expect(hits({ radius: 8, center: 'caster', relation: 'any', playersOnly: true }, 'boss')).toEqual(['p_at', 'p_in']);
    expect(hits({ radius: 8, center: 'caster', relation: 'ally' }, 'p_at')).toEqual(['p_at']);
  });

  it('centres on the explicit target when asked', () => {
    expect(hits({ radius: 0.5, center: 'target', relation: 'enemy' }, 'boss', 'p_in')).toEqual(['p_in']);
  });

  it('does not add the target combat reach when a creature caster hits a player', () => {
    // p_out at 8.01 has reach 1.5: inside 8 + 1.5 if reach were added, but a boss hitting a player uses centre distance only.
    expect(newSim().unit('p_out').combatReach).toBe(1.5);
    expect(hits({ radius: 8, center: 'caster', relation: 'enemy' }, 'boss')).not.toContain('p_out');
    expect(hits({ radius: 8.01, center: 'caster', relation: 'enemy' }, 'boss')).toContain('p_out');
  });

  it('adds the target combat reach when a player caster hits a creature', () => {
    // p_at → add: centre 9.434 <= 6.5 + 3; p_at → boss: 8 <= 6.5 + 8.
    expect(hits({ radius: 6.5, center: 'caster', relation: 'enemy' }, 'p_at')).toEqual(['add', 'boss']);
  });
});
