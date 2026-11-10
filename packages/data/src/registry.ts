import { DataEntrySchema, OverrideEntrySchema, type DataEntry, type Source, type Value } from './provenance';
import { PINS } from './pins';
import { formatZod } from './zod-format';

export type Profile = 'azerothcore' | 'rising-gods';

export interface Resolved {
  readonly key: string;
  readonly value: Value;
  readonly source: Source;
  /** Key of the Rising-Gods override that supplied the value, or null for the baseline. */
  readonly overriddenBy: string | null;
}

export class DataValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`data validation failed:\n- ${problems.join('\n- ')}`);
    this.name = 'DataValidationError';
  }
}

interface StoredOverride {
  readonly key: string;
  readonly value: Value;
  readonly source: Source;
}

const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export class DataRegistry {
  private readonly baseline = new Map<string, DataEntry>();
  private readonly overrides = new Map<string, StoredOverride>();
  private readonly accessed = new Map<string, Resolved>();

  constructor(
    entries: readonly unknown[],
    overrides: readonly unknown[] = [],
    readonly profile: Profile = 'azerothcore',
  ) {
    const problems: string[] = [];
    entries.forEach((raw, i) => {
      const r = DataEntrySchema.safeParse(raw);
      if (!r.success) {
        problems.push(`entry ${i}: ${formatZod(r.error)}`);
        return;
      }
      if (this.baseline.has(r.data.key)) {
        problems.push(`entry ${i}: duplicate key ${r.data.key}`);
        return;
      }
      this.baseline.set(r.data.key, r.data);
    });
    overrides.forEach((raw, i) => {
      const r = OverrideEntrySchema.safeParse(raw);
      if (!r.success) {
        problems.push(`override ${i}: ${formatZod(r.error)}`);
        return;
      }
      if (!this.baseline.has(r.data.overrides)) {
        problems.push(`override ${i}: unknown baseline key ${r.data.overrides}`);
        return;
      }
      if (this.overrides.has(r.data.overrides)) {
        problems.push(`override ${i}: second override for ${r.data.overrides}`);
        return;
      }
      this.overrides.set(r.data.overrides, { key: r.data.key, value: r.data.value, source: r.data.source });
    });
    for (const e of this.baseline.values()) {
      const s = e.source;
      if (s.kind === 'derived') {
        for (const input of s.inputs) {
          if (!this.baseline.has(input)) problems.push(`${e.key}: derived input ${input} does not exist`);
        }
      }
      if ((s.kind === 'code' || s.kind === 'db') && s.commit !== PINS.azerothcoreCommit) {
        problems.push(`${e.key}: commit ${s.commit} is not the pinned AzerothCore commit`);
      }
      if (s.kind === 'spelldata' && !PINS.spellDataVersions.includes(s.dataVersion)) {
        problems.push(`${e.key}: spell data version ${s.dataVersion} is not pinned in pins.ts`);
      }
    }
    if (problems.length > 0) throw new DataValidationError(problems);
  }

  get(key: string): Resolved {
    const base = this.baseline.get(key);
    if (!base) throw new Error(`unknown data key: ${key}`);
    const ov = this.profile === 'rising-gods' ? this.overrides.get(key) : undefined;
    const resolved: Resolved = ov
      ? { key, value: ov.value, source: ov.source, overriddenBy: ov.key }
      : { key, value: base.value, source: base.source, overriddenBy: null };
    this.accessed.set(key, resolved);
    return resolved;
  }

  num(key: string): number {
    const v = this.get(key).value;
    if (typeof v !== 'number') throw new Error(`data key ${key} is not a number`);
    return v;
  }

  baselineOf(key: string): DataEntry {
    const base = this.baseline.get(key);
    if (!base) throw new Error(`unknown data key: ${key}`);
    return base;
  }

  accessedEntries(): Resolved[] {
    return [...this.accessed.values()].sort(byKey);
  }

  /** Baseline keys that were used, have a Rising-Gods override, and were not overridden in this run. */
  knownUnappliedOverrides(): string[] {
    return this.accessedEntries()
      .filter((r) => r.overriddenBy === null && this.overrides.has(r.key))
      .map((r) => r.key);
  }
}
