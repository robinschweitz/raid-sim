import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { spellDataEntries } from '../src/spelldata/entries';
import { parseSpellDataFile } from '../src/spelldata/file';

const RAW = JSON.parse(readFileSync(new URL('../data/spelldata/festergut.json', import.meta.url), 'utf8')) as Record<string, any>;
const clone = (): Record<string, any> => JSON.parse(JSON.stringify(RAW));
const FIRST = 71219;
const spellOf = (raw: Record<string, any>, id = FIRST): Record<string, any> => raw.spells.find((s: { id: number }) => s.id === id);

describe('strict spell data validation', () => {
  it('the real file loads', () => {
    expect(() => parseSpellDataFile(RAW)).not.toThrow();
  });

  it.each([
    'schoolMask', 'stackAmount', 'maxAffectedTargets', 'speed', 'attributes', 'attributesEx', 'attributesEx2', 'attributesEx3',
    'attributesEx4', 'attributesEx5', 'attributesEx6', 'attributesEx7', 'castTimeMs', 'durationMs', 'rangeYd',
  ])('rejects a spell without %s', (field) => {
    const raw = clone();
    delete spellOf(raw)[field];
    expect(() => parseSpellDataFile(raw)).toThrow(new RegExp(`spell ${FIRST}.*${field}`));
  });

  it.each(['effect', 'basePoints', 'dieSides', 'implicitTargetA', 'implicitTargetB', 'applyAuraName', 'amplitude', 'miscValue', 'triggerSpell', 'index', 'radiusYd'])(
    'rejects an effect without %s',
    (field) => {
      const raw = clone();
      delete spellOf(raw).effects[0][field];
      expect(() => parseSpellDataFile(raw)).toThrow(new RegExp(`spell ${FIRST}.*${field}`));
    },
  );

  it('rejects non-finite numbers, a fractional effect index and malformed nested records', () => {
    const bad = (edit: (s: Record<string, any>) => void, re: RegExp): void => {
      const raw = clone();
      edit(spellOf(raw));
      expect(() => parseSpellDataFile(raw)).toThrow(re);
    };
    bad((s) => (s.speed = null), /speed/);
    bad((s) => (s.speed = '1'), /speed/);
    bad((s) => (s.schoolMask = Number.POSITIVE_INFINITY), /schoolMask/);
    bad((s) => (s.effects[0].index = 0.5), /index/);
    bad((s) => (s.effects[0].basePoints = 'x'), /basePoints/);
    bad((s) => (s.durationMs = { base: 1, perLevel: 0 }), /durationMs.*max/);
    bad((s) => (s.rangeYd = { minHostile: 0, minFriendly: 0, maxHostile: 1 }), /rangeYd.*maxFriendly/);
    bad((s) => (s.effects[0].radiusYd = { radius: 1 }), /radiusYd.*max/);
    bad((s) => (s.effects[0].radiusYd = 5), /radiusYd/);
  });

  it('checks the file records: client, dataVersion against name and sha256, duplicate names', () => {
    const edit = (f: (r: Record<string, any>) => void, re: RegExp): void => {
      const raw = clone();
      f(raw);
      expect(() => parseSpellDataFile(raw)).toThrow(re);
    };
    edit((r) => delete r.client, /client/);
    edit((r) => (r.client = 3), /client/);
    // A pinned version that belongs to another file or another hash.
    edit((r) => (r.files[0].name = 'SpellRange.dbc'), /does not match/);
    edit((r) => (r.files[0].sha256 = 'f'.repeat(64)), /does not match/);
    edit((r) => r.files.push({ ...r.files[0] }), /duplicate file Spell.dbc/);
  });
});

describe('spell data entries refuse scaling values', () => {
  const withSpell = (edit: (s: Record<string, any>) => void): ReturnType<typeof parseSpellDataFile> => {
    const raw = clone();
    edit(spellOf(raw));
    return parseSpellDataFile(raw);
  };
  it('a duration that scales per level or has a different maximum', () => {
    expect(() => spellDataEntries(withSpell((s) => (s.durationMs = { base: 1000, perLevel: 10, max: 1000 })), [FIRST])).toThrow(/duration scales/);
    expect(() => spellDataEntries(withSpell((s) => (s.durationMs = { base: 1000, perLevel: 0, max: 2000 })), [FIRST])).toThrow(/duration scales/);
    expect(() => spellDataEntries(withSpell((s) => (s.durationMs = { base: 1000, perLevel: 0, max: 1000 })), [FIRST])).not.toThrow();
  });
  it('a radius whose maximum differs from the radius', () => {
    expect(() => spellDataEntries(withSpell((s) => (s.effects[0].radiusYd = { radius: 5, max: 10 })), [FIRST])).toThrow(/maximum/);
    expect(() => spellDataEntries(withSpell((s) => (s.effects[0].radiusYd = { radius: 5, max: 5 })), [FIRST])).not.toThrow();
  });
});
