import { describe, expect, it } from 'vitest';
import { DataRegistry, DataValidationError } from '../src/registry';
import { PINS } from '../src/pins';

const commit = PINS.azerothcoreCommit;
const timer = { key: 'boss.timer_ms', value: 20000, source: { kind: 'code', file: 'boss.cpp', commit, line: 10 } };
const guess = { key: 'boss.guess', value: 5, source: { kind: 'assumption', rationale: 'r', confirmBy: 'c' } };
const override = {
  key: 'rg.boss.timer_ms',
  overrides: 'boss.timer_ms',
  value: 21000,
  source: {
    kind: 'log',
    logFile: 'logs/a.txt',
    encounter: { server: 'rising-gods', difficulty: '25n', date: '2026-11-01' },
    uncertainty: '±200 ms',
  },
};

describe('DataRegistry', () => {
  it('returns the baseline value for the azerothcore profile', () => {
    const r = new DataRegistry([timer], [override], 'azerothcore');
    expect(r.num('boss.timer_ms')).toBe(20000);
    expect(r.get('boss.timer_ms').overriddenBy).toBeNull();
  });

  it('returns the override for the rising-gods profile and keeps the baseline', () => {
    const r = new DataRegistry([timer], [override], 'rising-gods');
    expect(r.num('boss.timer_ms')).toBe(21000);
    expect(r.get('boss.timer_ms').overriddenBy).toBe('rg.boss.timer_ms');
    expect(r.baselineOf('boss.timer_ms').value).toBe(20000);
  });

  it('lists overrides that exist but were not applied', () => {
    const r = new DataRegistry([timer], [override], 'azerothcore');
    r.get('boss.timer_ms');
    expect(r.knownUnappliedOverrides()).toEqual(['boss.timer_ms']);
  });

  it('records accessed entries in key order', () => {
    const r = new DataRegistry([timer, guess]);
    r.get('boss.timer_ms');
    r.get('boss.guess');
    expect(r.accessedEntries().map((e) => e.key)).toEqual(['boss.guess', 'boss.timer_ms']);
  });

  it('rejects duplicate keys, missing derived inputs, foreign commits and unpinned spell data', () => {
    const entries = [
      timer,
      timer,
      { key: 'x.derived', value: 1, source: { kind: 'derived', formula: 'a', inputs: ['x.missing'] } },
      { key: 'x.code', value: 1, source: { kind: 'code', file: 'a.cpp', commit: 'a'.repeat(40), line: 1 } },
      { key: 'x.spell', value: 1, source: { kind: 'spelldata', spellId: 1, field: 'f', dataVersion: 'v1' } },
    ];
    try {
      new DataRegistry(entries);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DataValidationError);
      const problems = (e as DataValidationError).problems.join('\n');
      expect(problems).toContain('duplicate key boss.timer_ms');
      expect(problems).toContain('derived input x.missing does not exist');
      expect(problems).toContain('is not the pinned AzerothCore commit');
      expect(problems).toContain('spell data version v1 is not pinned');
    }
  });

  it('rejects an override of an unknown key', () => {
    expect(() => new DataRegistry([], [override])).toThrow(/unknown baseline key boss.timer_ms/);
  });

  it('rejects override key collisions', () => {
    const o2 = { ...override, key: 'boss.guess', overrides: 'boss.guess', value: 6 };
    expect(() => new DataRegistry([timer, guess], [{ ...override, key: 'boss.guess' }])).toThrow(/override 0: duplicate key boss.guess/);
    const dup = { ...o2, key: 'rg.boss.timer_ms' };
    expect(() => new DataRegistry([timer, guess], [override, dup])).toThrow(/override 1: duplicate key rg.boss.timer_ms/);
  });

  it('rejects an override whose value type differs from the baseline', () => {
    expect(() => new DataRegistry([timer], [{ ...override, value: 'fast' }])).toThrow(
      /override 0: value type string does not match baseline boss.timer_ms type number/,
    );
  });

  it('rejects stale derived values', () => {
    const derived = {
      key: 'boss.double',
      value: 40000,
      source: { kind: 'derived', formula: 'timer*2', inputs: ['boss.timer_ms'] },
    };
    expect(() => new DataRegistry([timer, derived], [override])).toThrow(
      /boss.double: input boss.timer_ms has a Rising-Gods override, so boss.double needs one too/,
    );
    const derivedOverride = { ...override, key: 'rg.boss.double', overrides: 'boss.double', value: 42000 };
    expect(() => new DataRegistry([timer, derived], [override, derivedOverride])).not.toThrow();
  });

  it('throws on unknown keys and non-numbers', () => {
    const r = new DataRegistry([{ key: 'a.s', value: 'x', source: { kind: 'configured', file: 'f' } }]);
    expect(() => r.get('nope')).toThrow(/unknown data key/);
    expect(() => r.num('a.s')).toThrow(/is not a number/);
  });
});
