import { applyEffects } from './effects';
import { fixedPeriodicDamage, periodicTickDamage } from './modifiers';
import { EventClass, type Scheduled } from './queue';
import type { Simulation } from './sim';
import { hasStatModifiers, refreshStats } from './stats';
import type { AuraHookContext, AuraRemoveReason } from './catalog';
import { auraKey, compareStrings, type AuraInstance } from './units';

export interface ApplyAuraOptions {
  /** The aura comes from an area effect: its periodic damage is area damage (A-026). */
  readonly viaArea?: boolean;
  /** The spell allows dead targets: a death-persistent aura may land on a dead unit (A-012). */
  readonly allowDeadTarget?: boolean;
  /** The applying spell has ignoreCasterDamageMods: periodic damage skips the caster's done factors (A-028, A-029). */
  readonly ignoreCasterMods?: boolean;
}

/**
 * Applies, stacks or replaces an aura; returns the event id. Returns null if the target is dead or the fight is over, and
 * also when the removal hook of a replaced instance killed the holder, decided the fight or re-applied the aura itself.
 */
export function applyAura(
  sim: Simulation,
  auraId: string,
  casterId: string,
  targetId: string,
  causes: readonly string[],
  options: ApplyAuraOptions = {},
): string | null {
  const def = sim.catalog.aura(auraId);
  const target = sim.unit(targetId);
  const deadOk = options.allowDeadTarget === true && def.deathPersistent === true;
  if ((!target.alive && !deadOk) || sim.over) return null;
  const key = auraKey(auraId, casterId, def.stackScope ?? 'caster');
  let existing = target.auras.get(key);
  if (existing && def.stackScope === 'unit_replace' && existing.casterId !== casterId) {
    // Area auras of different casters do not stack (SpellAuras.cpp 2131–2151, 2193–2210): the old instance goes first.
    removeInstance(sim, targetId, key, existing, 'replaced', causes);
    // A removal hook may have killed the holder, decided the fight or applied this aura itself; that result stands.
    if ((!target.alive && !deadOk) || sim.over || target.auras.has(key)) return null;
    existing = undefined;
  }
  const expiresMs = def.durationMs === null ? Number.POSITIVE_INFINITY : sim.now + def.durationMs;
  const traceExpiry = Number.isFinite(expiresMs) ? expiresMs : null;
  const schedule = (inst: AuraInstance): Scheduled | null =>
    Number.isFinite(expiresMs) ? sim.at(expiresMs, EventClass.AuraExpiry, () => expire(sim, targetId, key, inst)) : null;
  if (existing) {
    const previousStacks = existing.stacks;
    existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
    sim.cancel(existing.expiry);
    existing.expiresMs = expiresMs;
    existing.expiry = schedule(existing);
    existing.refreshedMs = sim.now;
    existing.ignoreCasterMods ||= options.ignoreCasterMods === true || def.ignoreCasterDamageMods === true;
    fixPeriodicAmounts(sim, existing);
    if (hasStatModifiers(def)) refreshStats(sim, targetId);
    const id = sim.emit(
      'aura_stack',
      { unit: targetId, aura: auraId, caster: casterId, stacks: existing.stacks, expiresMs: traceExpiry },
      causes,
    );
    if (def.periodic && existing.tick === null && target.auras.get(key) === existing) {
      // Resume at the kept tick anchor (A-009). It is always after now: a chain only stops when the anchor passes the expiry.
      scheduleTick(sim, targetId, key, existing);
    }
    if (target.alive || deadOk) sim.catalog.auraScript(auraId)?.afterStack?.(hookContext(sim, existing, targetId, [id], previousStacks));
    return id;
  }
  const inst: AuraInstance = {
    auraId,
    casterId,
    stacks: 1,
    appliedMs: sim.now,
    expiresMs,
    refreshedMs: sim.now,
    expiry: null,
    tick: null,
    nextTickMs: sim.now + (def.periodic?.intervalMs ?? 0),
    appliedEvent: '',
    viaArea: options.viaArea === true,
    ignoreCasterMods: options.ignoreCasterMods === true || def.ignoreCasterDamageMods === true,
    periodicAmounts: [],
  };
  inst.expiry = schedule(inst);
  fixPeriodicAmounts(sim, inst);
  target.auras.set(key, inst);
  if (hasStatModifiers(def)) refreshStats(sim, targetId);
  inst.appliedEvent = sim.emit('aura_applied', { unit: targetId, aura: auraId, caster: casterId, stacks: 1, expiresMs: traceExpiry }, causes);
  if (def.periodic && target.auras.get(key) === inst) scheduleTick(sim, targetId, key, inst);
  if (target.alive || deadOk) sim.catalog.auraScript(auraId)?.afterApply?.(hookContext(sim, inst, targetId, [inst.appliedEvent], 0));
  return inst.appliedEvent;
}

function hookContext(
  sim: Simulation,
  inst: AuraInstance,
  unitId: string,
  causes: readonly string[],
  previousStacks: number,
): AuraHookContext {
  return {
    sim,
    unitId,
    casterId: inst.casterId,
    auraId: inst.auraId,
    stacks: inst.stacks,
    previousStacks,
    appliedMs: inst.appliedMs,
    refreshedMs: inst.refreshedMs,
    expiresMs: Number.isFinite(inst.expiresMs) ? inst.expiresMs : null,
    causes,
  };
}

/** AuraEffect::HandleEffect calls the after-remove hooks for every remove mode (SpellAuraEffects.cpp 755–804, A-012). */
function afterRemove(sim: Simulation, inst: AuraInstance, unitId: string, removedId: string, reason: AuraRemoveReason): void {
  sim.catalog.auraScript(inst.auraId)?.afterRemove?.({ ...hookContext(sim, inst, unitId, [removedId], inst.stacks), reason });
}

/** Ends one instance without its on-expire effects: cancels its timers, writes aura_removed, runs afterRemove. */
function removeInstance(
  sim: Simulation,
  targetId: string,
  key: string,
  inst: AuraInstance,
  reason: AuraRemoveReason,
  causes: readonly string[],
): string {
  sim.cancel(inst.expiry);
  sim.cancel(inst.tick);
  sim.unit(targetId).auras.delete(key);
  if (hasStatModifiers(sim.catalog.aura(inst.auraId))) refreshStats(sim, targetId);
  const removed = sim.emit('aura_removed', { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason }, causes);
  afterRemove(sim, inst, targetId, removed, reason);
  return removed;
}

/**
 * AuraEffect::CalculateAmount (SpellAuraEffects.cpp 557–580): a periodic damage or heal amount is rolled once, takes the
 * caster's damage-done factor (truncated, A-017) and is multiplied by the stacks; recalculated whenever the aura is
 * applied, stacked or refreshed (A-029).
 */
function fixPeriodicAmounts(sim: Simulation, inst: AuraInstance): void {
  const def = sim.catalog.aura(inst.auraId);
  inst.periodicAmounts = (def.periodic?.effects ?? []).map((e) => {
    if (e.type !== 'damage' && e.type !== 'heal') return null;
    const rolled = sim.rng.stream(`unit:${inst.casterId}.amount`).int(e.min, e.max);
    if (e.type === 'heal') return rolled * inst.stacks;
    return fixedPeriodicDamage(sim, inst.casterId, e.school, rolled, inst.stacks, inst.ignoreCasterMods);
  });
}

/** One tick: fixed amounts take the victim's factors now (and the area factor for an area-applied aura); other effects run as usual. */
function tickEffects(sim: Simulation, inst: AuraInstance, targetId: string, tickId: string): void {
  const effects = sim.catalog.aura(inst.auraId).periodic?.effects ?? [];
  const ctx = { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [tickId], viaArea: inst.viaArea, ignoreCasterMods: inst.ignoreCasterMods, fromAura: true };
  effects.forEach((e, i) => {
    const fixed = inst.periodicAmounts[i] ?? null;
    if (fixed === null) {
      applyEffects(sim, [e], ctx);
    } else if (e.type === 'damage') {
      const amount = periodicTickDamage(sim, inst.casterId, targetId, e.school, fixed, inst.viaArea);
      sim.damage(targetId, amount, { sourceId: inst.casterId, ability: inst.auraId, school: e.school }, [tickId]);
    } else if (e.type === 'heal') {
      sim.heal(targetId, fixed, { sourceId: inst.casterId, ability: inst.auraId, school: 'holy' }, [tickId]);
    }
  });
}

function scheduleTick(sim: Simulation, targetId: string, key: string, inst: AuraInstance): void {
  const periodic = sim.catalog.aura(inst.auraId).periodic;
  if (!periodic) return;
  const at = inst.nextTickMs;
  if (at > inst.expiresMs) {
    inst.tick = null;
    return;
  }
  inst.tick = sim.at(at, EventClass.PeriodicTick, () => {
    inst.tick = null;
    const target = sim.unit(targetId);
    if (target.auras.get(key) !== inst) return;
    inst.nextTickMs += periodic.intervalMs;
    const tickId = sim.emit(
      'periodic_tick',
      { unit: targetId, aura: inst.auraId, caster: inst.casterId, stacks: inst.stacks },
      [inst.appliedEvent],
    );
    tickEffects(sim, inst, targetId, tickId);
    // A tick effect may have re-applied this aura, which already restarted the chain.
    if (target.auras.get(key) === inst && inst.tick === null) scheduleTick(sim, targetId, key, inst);
  });
}

function expire(sim: Simulation, targetId: string, key: string, inst: AuraInstance): void {
  const target = sim.unit(targetId);
  if (target.auras.get(key) !== inst) return;
  sim.cancel(inst.tick);
  target.auras.delete(key);
  if (hasStatModifiers(sim.catalog.aura(inst.auraId))) refreshStats(sim, targetId);
  const removed = sim.emit(
    'aura_removed',
    { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason: 'expired' },
    [inst.appliedEvent],
  );
  const onExpire = sim.catalog.aura(inst.auraId).onExpire;
  if (onExpire) applyEffects(sim, onExpire, { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [removed], ignoreCasterMods: inst.ignoreCasterMods, fromAura: true });
  afterRemove(sim, inst, targetId, removed, 'expired');
}

/** Removes every instance of an aura from a unit without its on-expire effect. Returns the event ids. */
export function removeAuras(
  sim: Simulation,
  targetId: string,
  auraId: string,
  reason: 'removed' | 'dispelled',
  causes: readonly string[],
): string[] {
  const target = sim.unit(targetId);
  const ids: string[] = [];
  for (const key of [...target.auras.keys()].sort(compareStrings)) {
    // A hook of an earlier removal may already have removed this instance.
    const inst = target.auras.get(key);
    if (!inst || inst.auraId !== auraId) continue;
    ids.push(removeInstance(sim, targetId, key, inst, reason, causes));
  }
  return ids;
}

/**
 * Death removes every aura that is not death-persistent, with reason death; afterRemove hooks run (Unit.cpp 5424–5443, A-012).
 * A hook may decide the fight (the last player dies): the remaining auras are then dropped silently, so no event follows the outcome.
 */
export function removeAurasOnDeath(sim: Simulation, unitId: string, deathId: string): void {
  const unit = sim.unit(unitId);
  for (const key of [...unit.auras.keys()].sort(compareStrings)) {
    // A hook of an earlier removal may already have removed this instance.
    const inst = unit.auras.get(key);
    if (!inst || sim.catalog.aura(inst.auraId).deathPersistent) continue;
    if (sim.over) {
      sim.cancel(inst.expiry);
      sim.cancel(inst.tick);
      unit.auras.delete(key);
      continue;
    }
    removeInstance(sim, unitId, key, inst, 'death', [deathId]);
  }
}
