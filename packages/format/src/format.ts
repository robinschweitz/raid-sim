import type { Trace, TraceEvent, TraceValue } from '@raid/engine';
import type { Dictionary } from './en';

const UNIT_KEYS = new Set(['boss', 'caster', 'target', 'unit', 'source', 'actor']);
const ABILITY_KEYS = new Set(['spell', 'ability', 'aura']);
/** `...Ms` keys that are absolute times; every other `...Ms` key is a duration. */
const CLOCK_KEYS = new Set(['endMs', 'expiresMs', 'arrivalMs', 'earliestMs', 'latestMs']);

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export function clock(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(m, 2)}:${pad(s, 2)}.${pad(ms % 1000, 3)}`;
}

export function createFormatter(trace: Trace, dict: Dictionary): (ev: TraceEvent) => string {
  const names = new Map(trace.meta.units.map((u) => [u.id, u.name]));
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
    const template = dict[ev.data.cleared === true ? `event.${ev.kind}_cleared` : `event.${ev.kind}`] ?? ev.kind;
    const text = template.replace(/\{(\w+)\}/g, (_m, key: string) => render(key, ev.data[key]));
    return `[${clock(ev.t)}] ${text}`;
  };
}

/** Readable event log; `extra` adds content names such as `ability.gas_spore`. */
export function formatLog(trace: Trace, dict: Dictionary, extra: Dictionary): string[] {
  const format = createFormatter(trace, { ...dict, ...extra });
  return trace.events.map(format);
}
