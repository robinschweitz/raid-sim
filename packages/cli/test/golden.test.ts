import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkGolden, readGolden } from '../src/golden';

const io = { readFile: (p: string) => readFileSync(p, 'utf8') };

describe('golden runs', () => {
  it('lists at least one scenario', () => {
    expect(Object.keys(readGolden(io)).length).toBeGreaterThan(0);
  });

  it('every pinned scenario still produces the same canonical trace (update deliberately with pnpm golden:update)', () => {
    expect(checkGolden(io)).toEqual([]);
  });
});
