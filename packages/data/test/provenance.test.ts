import { describe, expect, it } from 'vitest';
import { DataEntrySchema, OverrideEntrySchema, SourceSchema } from '../src/provenance';
import { PINS } from '../src/pins';

const commit = PINS.azerothcoreCommit;

describe('SourceSchema', () => {
  it('accepts every source kind', () => {
    const sources = [
      { kind: 'code', file: 'boss_festergut.cpp', commit, line: 123 },
      { kind: 'db', table: 'creature', key: 'guid=1', commit },
      { kind: 'spelldata', spellId: 69278, field: 'EffectRadiusIndex', dataVersion: 'client-12340' },
      {
        kind: 'log',
        logFile: 'logs/2026-11-01.txt',
        encounter: { server: 'rising-gods', difficulty: '25n', date: '2026-11-01' },
        uncertainty: '±0.5 s',
      },
      { kind: 'derived', formula: 'a * 2', inputs: ['x.a'] },
      { kind: 'configured', file: 'scenarios/festergut/plan.yaml' },
      { kind: 'assumption', rationale: 'no evidence yet', confirmBy: 'Gate 2 logs' },
    ];
    for (const s of sources) expect(SourceSchema.safeParse(s).success, JSON.stringify(s)).toBe(true);
  });

  it('rejects a short commit hash', () => {
    expect(SourceSchema.safeParse({ kind: 'code', file: 'a.cpp', commit: 'dca1a87', line: 1 }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(SourceSchema.safeParse({ kind: 'configured', file: 'a', extra: 1 }).success).toBe(false);
  });
});

describe('DataEntrySchema', () => {
  it('requires a source', () => {
    expect(DataEntrySchema.safeParse({ key: 'a.b', value: 1 }).success).toBe(false);
  });

  it('accepts a sourced value', () => {
    const r = DataEntrySchema.safeParse({ key: 'a.b', value: 1, source: { kind: 'configured', file: 'x' } });
    expect(r.success).toBe(true);
  });
});

describe('OverrideEntrySchema', () => {
  it('requires a log source', () => {
    const r = OverrideEntrySchema.safeParse({
      key: 'rg.a.b',
      overrides: 'a.b',
      value: 2,
      source: { kind: 'assumption', rationale: 'x', confirmBy: 'y' },
    });
    expect(r.success).toBe(false);
  });
});
