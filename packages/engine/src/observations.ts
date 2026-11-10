import type { ObservationCheck } from './plan/schema';
import { outcomeOf } from './summary';
import type { Trace, TraceEvent } from './trace';

export type CustomCheck = (args: {
  readonly trace: Trace;
  readonly params: Readonly<Record<string, unknown>>;
}) => { readonly pass: boolean; readonly detail: string };

export interface ObservationResult {
  readonly check: string;
  readonly pass: boolean;
  readonly detail: string;
}

function matches(e: TraceEvent, kind: string, where: Readonly<Record<string, string | number | boolean>>): boolean {
  if (e.kind !== kind) return false;
  return Object.entries(where).every(([k, v]) => e.data[k] === v);
}

export function evaluateObservations(
  checks: readonly ObservationCheck[],
  trace: Trace,
  custom: ReadonlyMap<string, CustomCheck>,
): ObservationResult[] {
  return checks.map((c): ObservationResult => {
    switch (c.check) {
      case 'outcome_is': {
        const actual = outcomeOf(trace).kind;
        return { check: 'outcome_is', pass: actual === c.outcome, detail: `expected ${c.outcome}, got ${actual}` };
      }
      case 'event_occurs': {
        const n = trace.events.filter((e) => matches(e, c.kind, c.where)).length;
        return { check: `event_occurs:${c.kind}`, pass: n > 0, detail: `${n} matching events` };
      }
      case 'event_absent': {
        const n = trace.events.filter((e) => matches(e, c.kind, c.where)).length;
        return { check: `event_absent:${c.kind}`, pass: n === 0, detail: `${n} matching events` };
      }
      case 'custom': {
        const fn = custom.get(c.name);
        if (!fn) return { check: `custom:${c.name}`, pass: false, detail: 'unknown custom check' };
        try {
          const r = fn({ trace, params: c.params });
          return { check: `custom:${c.name}`, pass: r.pass, detail: r.detail };
        } catch (err) {
          return { check: `custom:${c.name}`, pass: false, detail: `check threw: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
    }
  });
}
