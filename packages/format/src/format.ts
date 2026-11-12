import type { Trace, TraceEvent, TraceValue } from '@raid/engine';
import type { Dictionary } from './en';

const UNIT_KEYS = new Set(['boss', 'caster', 'target', 'unit', 'source', 'actor']);
const ABILITY_KEYS = new Set(['spell', 'ability', 'aura']);
/** `...Ms` keys that are absolute times; every other `...Ms` key is a duration. */
const CLOCK_KEYS = new Set(['endMs', 'expiresMs', 'arrivalMs', 'earliestMs', 'latestMs']);

export const STANDIN_MARK = '*';

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export function clock(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(m, 2)}:${pad(s, 2)}.${pad(ms % 1000, 3)}`;
}

export function createFormatter(trace: Trace, dict: Dictionary): (ev: TraceEvent) => string {
  // Stand-ins carry a marker in the log (spec §6.3); the header line of `formatLog` explains it.
  const names = new Map(trace.meta.units.map((u) => [u.id, u.approximate ? `${u.name}${STANDIN_MARK}` : u.name]));
  const render = (key: string, v: TraceValue | undefined): string => {
    if (v === undefined) return '';
    if (v === null) return key.endsWith('Ms') ? 'never' : '';
    if (Array.isArray(v)) return v.map((x) => render(key, x as string)).join(', ');
    if (typeof v === 'string' && UNIT_KEYS.has(key)) return names.get(v) ?? v;
    if (typeof v === 'string' && ABILITY_KEYS.has(key)) return dict[`ability.${v}`] ?? v;
    if (typeof v === 'number' && CLOCK_KEYS.has(key)) return clock(v);
    if (typeof v === 'number' && key.endsWith('Ms')) return `${v} ms`;
    return String(v);
  };
  return (ev) => {
    // A cleared timer window or a boss without a target (target: null) has its own wording.
    const cleared = ev.data.cleared === true || ev.data.target === null;
    const template = (cleared ? dict[`event.${ev.kind}_cleared`] : undefined) ?? dict[`event.${ev.kind}`] ?? ev.kind;
    const text = template.replace(/\{(\w+)\}/g, (_m, key: string) => render(key, ev.data[key]));
    return `[${clock(ev.t)}] ${text}`;
  };
}

/**
 * Readable event log; `extra` adds content names such as `ability.gas_spore`. When the run has stand-ins, the first line
 * lists them and explains the marker.
 */
export function formatLog(trace: Trace, dict: Dictionary, extra: Dictionary): string[] {
  const all = { ...dict, ...extra };
  const format = createFormatter(trace, all);
  const standIns = trace.meta.units.filter((u) => u.approximate).map((u) => u.name);
  const header = standIns.length > 0 ? [(all['log.standins'] ?? '{units}').replace('{units}', standIns.join(', '))] : [];
  // A heal of zero (a full target) says nothing to a reader; the trace keeps it.
  const shown = trace.events.filter((e) => !(e.kind === 'heal' && Number(e.data.amount) === 0));
  return [...header, ...shown.map(format)];
}
