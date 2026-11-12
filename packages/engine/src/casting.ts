import type { SpellDef } from './catalog';
import { launchSpell } from './launch';
import { edgeDistance } from './movement';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import type { CastState, Unit } from './units';

export type CastFailure =
  | 'unknown_spell'
  | 'dead'
  | 'casting'
  | 'gcd'
  | 'cooldown'
  | 'target_dead'
  | 'moving'
  | 'out_of_range'
  | 'fight_over';

export type CastCheck = { readonly ok: true } | { readonly ok: false; readonly reason: CastFailure };

export type CastResult =
  | { readonly ok: true; readonly event: string }
  | { readonly ok: false; readonly reason: CastFailure; readonly event: string };

const fail = (reason: CastFailure): CastCheck => ({ ok: false, reason });

function resolveTarget(spell: SpellDef, casterId: string, targetId: string): string {
  return spell.target === 'self' ? casterId : targetId;
}

export function checkCast(sim: Simulation, casterId: string, spellId: string, targetId: string): CastCheck {
  if (!sim.catalog.hasSpell(spellId)) return fail('unknown_spell');
  const spell = sim.catalog.spell(spellId);
  const caster = sim.unit(casterId);
  const target = sim.units.get(resolveTarget(spell, casterId, targetId));
  if (!caster.alive) return fail('dead');
  if (caster.cast) return fail('casting');
  if (spell.gcdMs > 0 && sim.now < caster.gcdUntilMs) return fail('gcd');
  if ((caster.cooldowns.get(spellId) ?? 0) > sim.now) return fail('cooldown');
  if (!target || !target.alive) return fail('target_dead');
  if (caster.move && spell.castTimeMs > 0 && !spell.usableWhileMoving) return fail('moving');
  if (target.id !== caster.id && edgeDistance(caster, target, sim.now) > spell.rangeYd) return fail('out_of_range');
  return { ok: true };
}

export interface CastOptions {
  /** AzerothCore CastSpell(..., triggered = true): no cast time, GCD, cooldown, casting or range checks (A-020).
   * A triggered cast still has projectile travel time, can still fail with `target_dead` while in flight, and is traced
   * with `castTimeMs: 0` and `triggered: true`. */
  readonly triggered?: boolean;
  /** SPELLVALUE_MAX_TARGETS for the spell's areas (A-027). */
  readonly maxTargets?: number;
  /** Random stream for the max-target subset; default `unit:<caster>.<spell>.targets`. */
  readonly targetStream?: string;
}

export function startCast(
  sim: Simulation,
  casterId: string,
  spellId: string,
  targetId: string,
  causes: readonly string[],
  options: CastOptions = {},
): CastResult {
  if (options.maxTargets !== undefined && (!Number.isInteger(options.maxTargets) || options.maxTargets < 1)) {
    throw new Error(`invalid maxTargets ${options.maxTargets}`);
  }
  // No events once the outcome is decided; `event` is empty because nothing was written.
  if (sim.over) return { ok: false, reason: 'fight_over', event: '' };
  const failed = (reason: CastFailure): CastResult => {
    const event = sim.emit('cast_failed', { caster: casterId, spell: spellId, target: targetId, reason }, causes);
    return { ok: false, reason, event };
  };
  if (options.triggered) {
    if (!sim.catalog.hasSpell(spellId)) return failed('unknown_spell');
    const spell = sim.catalog.spell(spellId);
    const caster = sim.unit(casterId);
    const tId = resolveTarget(spell, casterId, targetId);
    const target = sim.units.get(tId);
    if (!caster.alive) return failed('dead');
    if (!target || !target.alive) return failed('target_dead');
    const event = sim.emit(
      'cast_start',
      { caster: casterId, spell: spellId, target: tId, castTimeMs: 0, endMs: sim.now, triggered: true },
      causes,
    );
    complete(sim, caster, spell, tId, event, options);
    return { ok: true, event };
  }
  const check = checkCast(sim, casterId, spellId, targetId);
  if (!check.ok) return failed(check.reason);
  const spell = sim.catalog.spell(spellId);
  const caster = sim.unit(casterId);
  const tId = resolveTarget(spell, casterId, targetId);
  if (spell.gcdMs > 0) caster.gcdUntilMs = sim.now + spell.gcdMs;
  if (spell.castTimeMs === 0) {
    const event = sim.emit('cast_start', { caster: casterId, spell: spellId, target: tId, castTimeMs: 0, endMs: sim.now }, causes);
    complete(sim, caster, spell, tId, event, options);
    return { ok: true, event };
  }
  const endMs = sim.now + spell.castTimeMs;
  const cast: CastState = {
    spellId,
    targetId: tId,
    startMs: sim.now,
    endMs,
    handle: sim.at(endMs, EventClass.SpellHit, () => {
      if (caster.cast !== cast) return;
      caster.cast = null;
      complete(sim, caster, spell, tId, cast.startEvent, options);
    }),
    startEvent: '',
  };
  caster.cast = cast;
  cast.startEvent = sim.emit(
    'cast_start',
    { caster: casterId, spell: spellId, target: tId, castTimeMs: spell.castTimeMs, endMs },
    causes,
  );
  return { ok: true, event: cast.startEvent };
}

function complete(sim: Simulation, caster: Unit, spell: SpellDef, targetId: string, startEvent: string, options: CastOptions): void {
  if (!caster.alive) return;
  const target = sim.unit(targetId);
  if (!target.alive) {
    sim.emit('cast_failed', { caster: caster.id, spell: spell.id, target: targetId, reason: 'target_dead' }, [startEvent]);
    return;
  }
  const triggered = options.triggered === true;
  if (!triggered && target.id !== caster.id && edgeDistance(caster, target, sim.now) > spell.rangeYd) {
    sim.emit('cast_failed', { caster: caster.id, spell: spell.id, target: targetId, reason: 'out_of_range' }, [startEvent]);
    return;
  }
  if (!triggered && spell.cooldownMs > 0) caster.cooldowns.set(spell.id, sim.now + spell.cooldownMs);
  const success = sim.emit('cast_success', { caster: caster.id, spell: spell.id, target: targetId }, [startEvent]);
  launchSpell(sim, caster.id, spell, targetId, success, { maxTargets: options.maxTargets, targetStream: options.targetStream });
}

export function interruptCast(
  sim: Simulation,
  unitId: string,
  reason: 'moved' | 'stopped',
  causes: readonly string[],
): string | null {
  const u = sim.unit(unitId);
  if (!u.cast) return null;
  const spellId = u.cast.spellId;
  sim.cancel(u.cast.handle);
  u.cast = null;
  return sim.emit('cast_interrupted', { unit: unitId, spell: spellId, reason }, causes);
}

/** Engine-wide rules that react to events. Call once per simulation. */
export function installCoreRules(sim: Simulation): void {
  sim.subscribe((ev) => {
    if (ev.kind !== 'move_start' || typeof ev.data.unit !== 'string') return;
    const u = sim.unit(ev.data.unit);
    if (u.cast && !sim.catalog.spell(u.cast.spellId).usableWhileMoving) interruptCast(sim, u.id, 'moved', [ev.id]);
  });
}
