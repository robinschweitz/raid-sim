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
    plan: 'p',
    maxDurationMs: 1000,
    mistakes: [],
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

  it('renders only absolute-time keys as clocks; durations print in ms', () => {
    const t = trace();
    const ev = { id: 'e9', t: 61234, kind: 'cast_start', causes: [], data: { caster: 'p1', spell: 'bolt', castTimeMs: 1500, endMs: 62734 } } as Trace['events'][number];
    const dict = { ...EN, 'event.cast_start': '{caster} casts {spell} ({castTimeMs}) until {endMs}' };
    const withEvent: Trace = { ...t, events: [ev] };
    expect(formatLog(withEvent, dict, {})).toEqual(['[01:01.234] Alice casts bolt (1500 ms) until 01:02.734']);
  });
  it('renders a null ...Ms value (a permanent aura expiry) as never', () => {
    const t = trace();
    const ev = { id: 'e9', t: 0, kind: 'aura_applied', causes: [], data: { unit: 'p1', aura: 'blight', expiresMs: null } } as Trace['events'][number];
    const dict = { ...EN, 'event.aura_applied': '{unit} gets {aura} until {expiresMs}' };
    expect(formatLog({ ...t, events: [ev] }, dict, {})).toEqual(['[00:00.000] Alice gets blight until never']);
  });
  it('renders a boss without a target readably', () => {
    const t = trace();
    const ev = { id: 'e9', t: 0, kind: 'threat_target', causes: [], data: { boss: 'boss', target: null, previous: 'p1' } } as Trace['events'][number];
    expect(formatLog({ ...t, events: [ev] }, EN, {})).toEqual([`[00:00.000] ${t.meta.units.find((u) => u.id === 'boss')!.name} has no target`]);
  });

  it('renders a cleared timer window readably', () => {
    const t = trace();
    const ev = { id: 'e9', t: 0, kind: 'timer_window', causes: [], data: { boss: 'boss', ability: 'smash', earliestMs: null, latestMs: null, cleared: true } } as Trace['events'][number];
    expect(formatLog({ ...t, events: [ev] }, EN, { 'ability.smash': 'Smash' })).toEqual(['[00:00.000] Smash timer cleared']);
  });
});
