export const EVENT_KINDS = [
  'engage',
  'ai_event',
  'cast_start',
  'cast_success',
  'cast_failed',
  'cast_interrupted',
  'spell_hit',
  'damage',
  'heal',
  'aura_applied',
  'aura_stack',
  'aura_removed',
  'periodic_tick',
  'move_start',
  'move_end',
  'rule_fired',
  'action_failed',
  'phase_change',
  'timer_window',
  'death',
  'outcome',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type TraceValue = string | number | boolean | null | readonly string[];

export interface TraceEvent {
  readonly id: string;
  readonly t: number;
  readonly kind: EventKind;
  readonly causes: readonly string[];
  readonly data: Readonly<Record<string, TraceValue>>;
}

export interface UnitSnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly alive: boolean;
  readonly auras: readonly (readonly [string, number])[];
  readonly cast: string | null;
}

export interface Snapshot {
  readonly t: number;
  readonly units: readonly UnitSnapshot[];
}

export interface TraceUnitMeta {
  readonly id: string;
  readonly name: string;
  readonly kind: 'player' | 'creature';
  readonly role: string;
  readonly approximate: boolean;
}

export interface TraceMeta {
  readonly engineVersion: string;
  readonly azerothcoreCommit: string;
  readonly spellDataVersions: readonly string[];
  readonly scenario: string;
  readonly boss: string;
  readonly difficulty: string;
  readonly seed: number;
  readonly profile: string;
  readonly aiUpdateIntervalMs: number;
  readonly sampleIntervalMs: number;
  readonly units: readonly TraceUnitMeta[];
}

export interface Trace {
  readonly schemaVersion: 1;
  readonly meta: TraceMeta;
  readonly events: readonly TraceEvent[];
  readonly snapshots: readonly Snapshot[];
}

export class TraceWriter {
  private readonly events: TraceEvent[] = [];
  private readonly snapshots: Snapshot[] = [];
  private readonly byId = new Map<string, TraceEvent>();
  private n = 0;

  emit(t: number, kind: EventKind, data: Readonly<Record<string, TraceValue>>, causes: readonly string[] = []): TraceEvent {
    for (const c of causes) if (!this.byId.has(c)) throw new Error(`unknown cause ${c}`);
    const ev: TraceEvent = { id: `e${++this.n}`, t, kind, causes: [...causes], data: { ...data } };
    this.events.push(ev);
    this.byId.set(ev.id, ev);
    return ev;
  }

  get(id: string): TraceEvent | undefined {
    return this.byId.get(id);
  }

  list(): readonly TraceEvent[] {
    return this.events;
  }

  snapshot(s: Snapshot): void {
    this.snapshots.push(s);
  }

  build(meta: TraceMeta): Trace {
    return { schemaVersion: 1, meta, events: [...this.events], snapshots: [...this.snapshots] };
  }
}

/** JSON with object keys sorted at every level, so equal traces are byte-identical. */
export function canonicalStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number in trace');
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const parts = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalStringify(o[k])}`);
    return `{${parts.join(',')}}`;
  }
  throw new Error(`cannot serialise ${typeof value}`);
}
