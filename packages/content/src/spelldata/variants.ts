import type { Difficulty } from '@raid/data';
import type { SpellDataFile } from './file';

/** Slot of each difficulty in a SpellDifficulty row: [10n, 25n, 10h, 25h] (spawn modes 0..3). */
const SLOT: Readonly<Record<Difficulty, number>> = { '10n': 0, '25n': 1, '10h': 2, '25h': 3 };

/** Difficulty variants of the spells in a spell data file, found by any id of their row. */
export class SpellVariants {
  private readonly rows = new Map<number, readonly number[]>();

  constructor(file: SpellDataFile) {
    for (const s of file.spells) {
      const row = s.difficultyVariants;
      if (!row) continue;
      if (row.length !== 4) throw new Error(`spell ${s.id}: difficultyVariants needs 4 ids, has ${row.length}`);
      for (const id of row) {
        if (id === 0) continue;
        const known = this.rows.get(id);
        if (known && known.join(',') !== row.join(',')) throw new Error(`spell ${id} is in two difficulty rows`);
        this.rows.set(id, row);
      }
    }
  }

  /**
   * GetSpellIdForDifficulty (SpellMgr.cpp 538–578, pinned dca1a87): any id of a row finds the row (the searcher map,
   * 529–535); an empty heroic slot (mode > 1) falls back two modes (10h → 10n, 25h → 25n; 564–568); a
   * slot that is still empty (570–574), or a spell without a row (554–556), keeps the given id. Not modelled: the
   * map check (non-dungeon maps keep the id, 543–544) and the missing-SpellInfo check (580–591).
   */
  variantFor(spellId: number, difficulty: Difficulty): number {
    const row = this.rows.get(spellId);
    if (!row) return spellId;
    const slot = SLOT[difficulty];
    let id = row[slot];
    if (id <= 0 && slot > 1) id = row[slot - 2];
    return id <= 0 ? spellId : id;
  }
}
