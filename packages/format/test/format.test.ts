import { EventClass, Simulation, canonicalStringify, type Trace } from '@raid/engine';
import { describe, expect, it } from 'vitest';
import { EN } from '../src/en';
import { clock, formatLog } from '../src/format';

function trace(): Trace {
  const sim = new Simulation({ seed: 1, maxDurationMs: 2000, sampleIntervalMs: 1000 });
  const body = { speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389, pos: { x: 0, y: 0 } };
  sim.addUnit({ ...body, id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1000000 });
  sim.addUnit({ ...body, id: 'p1', name: 'Alice', kind: 'player', role: 'ranged', maxHealth: 1000 });
  sim.emit('engage', { boss: 'boss' });
  sim.at(1500, EventClass.SpellHit, () => void sim.damage('p1', 300, { sourceId: 'boss', ability: 'smash', school: 'physical' }, []));
  sim.run();
  return sim.trace.build({
    engineVersion: 'test',
    azerothcoreCommit: 'x',
    spellDataVersions: [],
    scenario: 's',
    boss: 'boss',
    difficulty: '25n',
    seed: 1,
    profile: 'azerothcore',
    aiUpdateIntervalMs: 10,
    sampleIntervalMs: 1000,
    units: sim.sortedUnits().map((u) => ({ id: u.id, name: u.name, kind: u.kind, role: u.role, approximate: u.approximate })),
  });
}

describe('formatter', () => {
  it('formats the clock as mm:ss.mmm', () => {
    expect(clock(0)).toBe('00:00.000');
    expect(clock(61234)).toBe('01:01.234');
  });

  it('renders unit names and ability names from the dictionary', () => {
    const lines = formatLog(trace(), EN, { 'ability.smash': 'Smash' });
    expect(lines).toEqual(['[00:00.000] Boss engaged', '[00:01.500] Boss Smash hits Alice for 300', '[00:02.000] Outcome: timeout']);
  });

  it('changing the locale does not change the canonical trace (D6)', () => {
    const t = trace();
    const before = canonicalStringify(t);
    const english = formatLog(t, EN, {});
    const other = formatLog(t, { ...EN, 'event.damage': '{target} <- {ability} ({amount})' }, {});
    expect(other).not.toEqual(english);
    expect(canonicalStringify(t)).toBe(before);
    expect(canonicalStringify(trace())).toBe(before);
  });
});
