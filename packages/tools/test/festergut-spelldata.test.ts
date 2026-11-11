import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINS } from '@raid/data';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FILE = join(ROOT, 'packages', 'content', 'data', 'spelldata', 'festergut.json');

/** The versions recorded in docs/sources.md, from the owner's deDE 3.3.5a client (2026-11-11). */
const VERSIONS = [
  'client-12340:Spell.dbc:a17bfd2d4b0a',
  'client-12340:SpellCastTimes.dbc:919ca9b65cb1',
  'client-12340:SpellDifficulty.dbc:9173f9a8c97e',
  'client-12340:SpellDuration.dbc:caa2cbec7fa7',
  'client-12340:SpellRadius.dbc:409b1612d19b',
  'client-12340:SpellRange.dbc:dec6105c88d1',
];

const REQUESTED = [69165, 69195, 72219, 72227, 69278, 69290, 69240, 69291, 72296, 69157, 69162, 69164, 69126, 69152, 69154, 47008];

describe('Festergut spell data from the client', () => {
  it('pins exactly the versions listed in docs/sources.md', () => {
    expect([...PINS.spellDataVersions]).toEqual(VERSIONS);
    const doc = readFileSync(join(ROOT, 'docs', 'sources.md'), 'utf8');
    for (const v of VERSIONS) expect(doc, v).toContain(v);
  });

  it('has the extraction, with every requested spell and the pinned versions', () => {
    expect(existsSync(FILE)).toBe(true);
    const data = JSON.parse(readFileSync(FILE, 'utf8')) as {
      files: { dataVersion: string }[];
      spells: { id: number }[];
      missing: number[];
    };
    expect(data.spells.length).toBeGreaterThanOrEqual(59);
    const ids = new Set(data.spells.map((s) => s.id));
    for (const id of REQUESTED) expect(ids.has(id), String(id)).toBe(true);
    expect(data.missing).toEqual([]);
    expect(data.files.map((f) => f.dataVersion).sort()).toEqual([...PINS.spellDataVersions].sort());
  });
});
