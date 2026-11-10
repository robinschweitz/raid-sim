import type { Limitations } from './limitations';
import type { ObservationResult } from './observations';
import type { OutcomeKind } from './sim';
import type { Trace, TraceEvent } from './trace';

export interface UnitTotals {
  damageDone: number;
  healingDone: number;
  overhealing: number;
  damageTaken: number;
}

export interface DeathRecord {
  readonly unit: string;
  readonly atMs: number;
  readonly killingBlow: {
    readonly event: string;
    readonly ability: string;
    readonly source: string;
    readonly amount: number;
    readonly overkill: number;
  } | null;
  /** Event ids leading to the death, breadth-first from the death's causes, at most CHAIN_LIMIT. */
  readonly chain: readonly string[];
}

export interface Summary {
  readonly outcome: OutcomeKind;
  readonly durationMs: number;
  readonly deaths: readonly DeathRecord[];
  readonly units: Readonly<Record<string, UnitTotals>>;
  readonly maxStacks: Readonly<Record<string, { readonly unit: string; readonly stacks: number }>>;
  readonly observations: readonly ObservationResult[];
  readonly limitations: Limitations;
}

export const CHAIN_LIMIT = 10;

export function outcomeOf(trace: Trace): { readonly kind: OutcomeKind; readonly atMs: number } {
  const ev = [...trace.events].reverse().find((e) => e.kind === 'outcome');
  if (!ev) throw new Error('trace has no outcome event');
  return { kind: ev.data.kind as OutcomeKind, atMs: ev.t };
}

export function causeChain(trace: Trace, start: TraceEvent, limit = CHAIN_LIMIT): string[] {
  const byId = new Map(trace.events.map((e) => [e.id, e]));
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [...start.causes];
  while (queue.length > 0 && out.length < limit) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    const ev = byId.get(id);
    if (ev) queue.push(...ev.causes);
  }
  return out;
}

export function buildSummary(trace: Trace, limitations: Limitations, observations: readonly ObservationResult[]): Summary {
  const byId = new Map(trace.events.map((e) => [e.id, e]));
  const units: Record<string, UnitTotals> = {};
  const totals = (id: string): UnitTotals => (units[id] ??= { damageDone: 0, healingDone: 0, overhealing: 0, damageTaken: 0 });
  for (const u of trace.meta.units) totals(u.id);
  const maxStacks: Record<string, { unit: string; stacks: number }> = {};
  const deaths: DeathRecord[] = [];
  for (const e of trace.events) {
    const d = e.data;
    if (e.kind === 'damage') {
      totals(String(d.source)).damageDone += Number(d.amount);
      totals(String(d.target)).damageTaken += Number(d.amount);
    } else if (e.kind === 'heal') {
      const t = totals(String(d.source));
      t.healingDone += Number(d.amount);
      t.overhealing += Number(d.overheal);
    } else if (e.kind === 'aura_applied' || e.kind === 'aura_stack') {
      const aura = String(d.aura);
      const stacks = Number(d.stacks);
      const cur = maxStacks[aura];
      if (!cur || stacks > cur.stacks) maxStacks[aura] = { unit: String(d.unit), stacks };
    } else if (e.kind === 'death') {
      const blow = e.causes.map((c) => byId.get(c)).find((c) => c?.kind === 'damage');
      deaths.push({
        unit: String(d.unit),
        atMs: e.t,
        killingBlow: blow
          ? {
              event: blow.id,
              ability: String(blow.data.ability),
              source: String(blow.data.source),
              amount: Number(blow.data.amount),
              overkill: Number(blow.data.overkill),
            }
          : null,
        chain: causeChain(trace, e),
      });
    }
  }
  const outcome = outcomeOf(trace);
  return { outcome: outcome.kind, durationMs: outcome.atMs, deaths, units, maxStacks, observations: [...observations], limitations };
}
