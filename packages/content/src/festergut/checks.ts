import type { CustomCheck, Trace, TraceEvent } from '@raid/engine';

type Result = ReturnType<CustomCheck>;

const players = (trace: Trace): Set<string> => new Set(trace.meta.units.filter((u) => u.kind === 'player').map((u) => u.id));

function text(params: Readonly<Record<string, unknown>>, key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || v === '') throw new Error(`param ${key} must be a non-empty string`);
  return v;
}

/** One Pungent Blight cast: the Inoculated stacks of every player it hit, and the damage it did (overkill included). */
interface PungentCast {
  readonly atMs: number;
  readonly stacks: Map<string, number>;
  readonly damage: Map<string, number>;
}

/** Walks the trace once: Inoculated stacks are read at each player's `spell_hit`, before the spell script removes them. */
export function pungentCasts(trace: Trace): PungentCast[] {
  const stacks = new Map<string, number>();
  const casts: PungentCast[] = [];
  const byCast = new Map<string, PungentCast>();
  const hitOf = new Map<string, PungentCast>();
  for (const e of trace.events) {
    const d = e.data;
    if (d.aura === 'inoculated' && typeof d.unit === 'string') {
      if (e.kind === 'aura_removed') stacks.delete(d.unit);
      else if (e.kind === 'aura_applied' || e.kind === 'aura_stack') stacks.set(d.unit, Number(d.stacks));
    } else if (e.kind === 'cast_success' && d.spell === 'pungent_blight') {
      const cast: PungentCast = { atMs: e.t, stacks: new Map(), damage: new Map() };
      casts.push(cast);
      byCast.set(e.id, cast);
    } else if (e.kind === 'spell_hit' && d.spell === 'pungent_blight' && typeof d.target === 'string' && d.target !== d.caster) {
      const cast = byCast.get(e.causes[0] ?? '');
      if (!cast) continue;
      cast.stacks.set(d.target, stacks.get(d.target) ?? 0);
      hitOf.set(e.id, cast);
    } else if (e.kind === 'damage' && d.ability === 'pungent_blight' && typeof d.target === 'string') {
      hitOf.get(e.causes[0] ?? '')?.damage.set(d.target, Number(d.amount) + Number(d.overkill));
    }
  }
  return casts;
}

/** No player dies. (The built-in `event_absent` on `death` cannot say this: the boss's death is a death event too.) */
const noPlayerDeaths: CustomCheck = ({ trace }): Result => {
  const ids = players(trace);
  const dead = trace.events.filter((e) => e.kind === 'death' && ids.has(String(e.data.unit))).map((e) => String(e.data.unit));
  return { pass: dead.length === 0, detail: dead.length === 0 ? 'no player died' : `died: ${dead.join(', ')}` };
};

/**
 * Every player a Pungent Blight hits has at least `minStacks` Inoculated stacks at that moment, except the players in
 * `except`; at least one Pungent Blight must be cast and hit a player not in `except`.
 */
const inoculatedAtPungent: CustomCheck = ({ trace, params }): Result => {
  const min = Number(params.minStacks ?? 3);
  const except = new Set(Array.isArray(params.except) ? params.except.map(String) : []);
  const casts = pungentCasts(trace);
  if (casts.length === 0) return { pass: false, detail: 'Pungent Blight was never cast' };
  const short: string[] = [];
  let lowest = Number.POSITIVE_INFINITY;
  for (const c of casts) {
    for (const [unit, n] of c.stacks) {
      if (except.has(unit)) continue;
      lowest = Math.min(lowest, n);
      if (n < min) short.push(`${unit} had ${n} at ${c.atMs} ms`);
    }
  }
  // A check that looked at nobody proves nothing.
  if (lowest === Number.POSITIVE_INFINITY) return { pass: false, detail: 'Pungent Blight hit no player outside except' };
  return { pass: short.length === 0, detail: short.length === 0 ? `${casts.length} Pungent Blight cast(s); lowest stacks ${lowest}` : short.join('; ') };
};

/**
 * The first Pungent Blight finds `player` with fewer Inoculated stacks than every other player it hits, and does more
 * damage to `player` than to any of them.
 */
const missedSpores: CustomCheck = ({ trace, params }): Result => {
  const player = text(params, 'player');
  const first = pungentCasts(trace)[0];
  if (!first) return { pass: false, detail: 'Pungent Blight was never cast' };
  const own = first.stacks.get(player);
  const ownDamage = first.damage.get(player);
  if (own === undefined || ownDamage === undefined) return { pass: false, detail: `${player} was not hit by the first Pungent Blight` };
  const others = [...first.stacks].filter(([id]) => id !== player);
  if (others.length === 0) return { pass: false, detail: 'nobody else was hit' };
  const fewestOther = Math.min(...others.map(([, n]) => n));
  const mostOtherDamage = Math.max(...others.map(([id]) => first.damage.get(id) ?? 0));
  return {
    pass: own < fewestOther && ownDamage > mostOtherDamage,
    detail: `${player}: ${own} stacks, ${ownDamage} damage; the others: at least ${fewestOther} stacks, at most ${mostOtherDamage} damage`,
  };
};

/**
 * Gastric Explosion and its cause (spec §10.3, "the cause chain links it to the rule threshold"): `tank` casts Gastric
 * Explosion; the Gastric Bloat hit behind it also raised the aura to its last stack; rule `rule` fired on that same
 * stack event, so it fired too late; and the scenario lists a `set_stack_threshold` mistake for that rule.
 */
const lateSwap: CustomCheck = ({ trace, params }): Result => {
  const rule = text(params, 'rule');
  const tank = text(params, 'tank');
  const explosion = trace.events.find((e) => e.kind === 'cast_start' && e.data.spell === 'gastric_explosion' && e.data.caster === tank);
  if (!explosion) return { pass: false, detail: `${tank} never cast Gastric Explosion` };
  const hit = explosion.causes[0];
  const stack = trace.events.find((e) => e.kind === 'aura_stack' && e.data.aura === 'gastric_bloat' && e.data.unit === tank && e.causes.includes(hit ?? ''));
  if (!stack) return { pass: false, detail: 'no Gastric Bloat stack event shares the cause of the explosion' };
  const fired = trace.events.find((e: TraceEvent) => e.kind === 'rule_fired' && e.data.rule === rule && e.causes.includes(stack.id));
  if (!fired) return { pass: false, detail: `rule ${rule} did not fire on the stack that caused the explosion (stack ${stack.data.stacks})` };
  const mistake = trace.meta.mistakes.map((m) => JSON.parse(m) as { type?: string; rule?: string; atLeast?: number }).find((m) => m.type === 'set_stack_threshold' && m.rule === rule);
  if (!mistake) return { pass: false, detail: `the scenario has no set_stack_threshold mistake for rule ${rule}` };
  return {
    pass: true,
    detail: `rule ${rule} (threshold ${mistake.atLeast}, a scenario mistake) fired at ${fired.t} ms on stack ${stack.data.stacks} of Gastric Bloat, the stack that made ${tank} explode`,
  };
};

export const FESTERGUT_CHECKS: ReadonlyMap<string, CustomCheck> = new Map([
  ['raid.no_player_deaths', noPlayerDeaths],
  ['festergut.inoculated_at_pungent', inoculatedAtPungent],
  ['festergut.missed_spores', missedSpores],
  ['festergut.late_swap', lateSwap],
]);
