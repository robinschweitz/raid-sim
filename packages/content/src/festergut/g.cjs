const edit=require('./e.cjs');
edit('engine/src/units.ts',[
["export const byId = (a: { readonly id: string }, b: { readonly id: string }): number =>\n  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;",
 "/** Locale-independent string order (UTF-16 code units); the one comparator used wherever order must be deterministic. */\nexport const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);\n\nexport const byId = (a: { readonly id: string }, b: { readonly id: string }): number => compareStrings(a.id, b.id);"],
]);
edit('engine/src/sim.ts',[
["const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);\n",""],
["import { byId, createUnit,","import { byId, compareStrings, createUnit,"],
["sort(byString)","sort(compareStrings)"],
["byString(a[0], b[0])","compareStrings(a[0], b[0])"],
["  subscribe(listener","  /** True once the outcome is decided (or being decided): nothing may emit events or act after this. */\n  get over(): boolean {\n    return this.outcome !== null || this.ending;\n  }\n\n  subscribe(listener"],
["if (!u.alive || this.outcome || this.ending) return null;\n    const rounded = Math.max(0, Math.round(amount));\n    const dealt","if (!u.alive || this.over) return null;\n    const rounded = Math.max(0, Math.round(amount));\n    const dealt"],
["if (!u.alive || this.outcome || this.ending) return null;\n    const rounded = Math.max(0, Math.round(amount));\n    const effective","if (!u.alive || this.over) return null;\n    const rounded = Math.max(0, Math.round(amount));\n    const effective"],
]);
edit('engine/src/auras.ts',[
["import { auraKey, type AuraInstance } from './units';\n\nconst byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);\n","import { auraKey, compareStrings, type AuraInstance } from './units';\n"],
["/** Applies or stacks an aura; returns the event id, or null if the target is dead. */","/** Applies or stacks an aura; returns the event id, or null if the target is dead or the fight is over. */"],
["  if (!target.alive) return null;\n  const key","  if (!target.alive || sim.over) return null;\n  const key"],
["sort(byString)","sort(compareStrings)"],
]);
edit('engine/src/boss.ts',[
["const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);\n",""],
["sort(byString)","sort(compareStrings)"],
]);
edit('engine/src/view.ts',[
["const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);\n",""],
["byString(a.aura, b.aura) || byString(a.caster, b.caster)","compareStrings(a.aura, b.aura) || compareStrings(a.caster, b.caster)"],
["sort(byString)","sort(compareStrings)"],
["byString(a.boss, b.boss) || byString(a.ability, b.ability)","compareStrings(a.boss, b.boss) || compareStrings(a.ability, b.ability)"],
]);
edit('engine/src/rng.ts',[
["const pool = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));","const pool = [...items].sort(byId);"],
["const STREAM_NAME","import { byId } from './units';\n\nconst STREAM_NAME"],
]);
edit('engine/src/rules.ts',[
["(a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),","(a, b) => b.priority - a.priority || compareStrings(a.id, b.id),"],
["[...plan.roster].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))","[...plan.roster].sort(byId)"],
["[...rule.who].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))","[...rule.who].sort(compareStrings)"],
["import type { Unit, Vec2 } from './units';","import { byId, compareStrings, type Unit, type Vec2 } from './units';"],
["if (!actor || !actor.alive || this.sim.outcome) return false;","if (!actor || !actor.alive || this.sim.over) return false;"],
["if (!actor.alive || this.sim.outcome) return;\n    let result","if (!actor.alive || this.sim.over) return;\n    let result"],
]);
edit('engine/src/casting.ts',[
["  | 'out_of_range';","  | 'out_of_range'\n  | 'fight_over';"],
["): CastResult {\n  const check = checkCast(","): CastResult {\n  // No events once the outcome is decided; `event` is empty because nothing was written.\n  if (sim.over) return { ok: false, reason: 'fight_over', event: '' };\n  const check = checkCast("],
]);
edit('engine/src/standin.ts',[
["/** Lowest health percentage in range (not lowest absolute health); ties go to the lowest id (A-011). */","/** Lowest health percentage in range (not lowest absolute health); ties go to the lowest id, as players() is sorted (A-011). */"],
["if (ratio < bestRatio || (ratio === bestRatio && best !== null && p.id < best.id)) {","if (ratio < bestRatio) {"],
]);
edit('format/src/format.ts',[
["const ABILITY_KEYS = new Set(['spell', 'ability', 'aura']);","const ABILITY_KEYS = new Set(['spell', 'ability', 'aura']);\n/** `...Ms` keys that are absolute times; every other `...Ms` key is a duration. */\nconst CLOCK_KEYS = new Set(['endMs', 'expiresMs', 'arrivalMs', 'earliestMs', 'latestMs']);"],
["if (typeof v === 'number' && key.endsWith('Ms')) return clock(v);","if (typeof v === 'number' && CLOCK_KEYS.has(key)) return clock(v);\n    if (typeof v === 'number' && key.endsWith('Ms')) return `${v} ms`;"],
]);
