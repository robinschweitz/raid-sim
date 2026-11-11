import { applyEffects } from './effects';
import { EventClass, type Scheduled } from './queue';
import type { Simulation } from './sim';
import type { AuraHookContext, AuraRemoveReason } from './catalog';
import { auraKey, compareStrings, type AuraInstance } from './units';

/** Applies or stacks an aura; returns the event id, or null if the target is dead or the fight is over. */
export function applyAura(
  sim: Simulation,
  auraId: string,
  casterId: string,
  targetId: string,
  causes: readonly string[],
): string | null {
  const def = sim.catalog.aura(auraId);
  const target = sim.unit(targetId);
  if (!target.alive || sim.over) return null;
  const key = auraKey(auraId, casterId, def.stackScope ?? 'caster');
  const expiresMs = def.durationMs === null ? Number.POSITIVE_INFINITY : sim.now + def.durationMs;
  const traceExpiry = Number.isFinite(expiresMs) ? expiresMs : null;
  const schedule = (inst: AuraInstance): Scheduled | null =>
    Number.isFinite(expiresMs) ? sim.at(expiresMs, EventClass.AuraExpiry, () => expire(sim, targetId, key, inst)) : null;
  const existing = target.auras.get(key);
  if (existing) {
    const previousStacks = existing.stacks;
    existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
    sim.cancel(existing.expiry);
    existing.expiresMs = expiresMs;
    existing.expiry = schedule(existing);
    existing.refreshedMs = sim.now;
    const id = sim.emit(
      'aura_stack',
      { unit: targetId, aura: auraId, caster: casterId, stacks: existing.stacks, expiresMs: traceExpiry },
      causes,
    );
    if (def.periodic && existing.tick === null && target.auras.get(key) === existing) {
      // Resume at the kept tick anchor (A-009). It is always after now: a chain only stops when the anchor passes the expiry.
      scheduleTick(sim, targetId, key, existing);
    }
    if (target.alive) sim.catalog.auraScript(auraId)?.afterStack?.(hookContext(sim, existing, targetId, [id], previousStacks));
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
  };
  inst.expiry = schedule(inst);
  target.auras.set(key, inst);
  inst.appliedEvent = sim.emit('aura_applied', { unit: targetId, aura: auraId, caster: casterId, stacks: 1, expiresMs: traceExpiry }, causes);
  if (def.periodic && target.auras.get(key) === inst) scheduleTick(sim, targetId, key, inst);
  if (target.alive) sim.catalog.auraScript(auraId)?.afterApply?.(hookContext(sim, inst, targetId, [inst.appliedEvent], 0));
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
    causes,
  };
}

function afterRemove(sim: Simulation, inst: AuraInstance, unitId: string, removedId: string, reason: AuraRemoveReason): void {
  if (!sim.unit(unitId).alive) return;
  sim.catalog.auraScript(inst.auraId)?.afterRemove?.({ ...hookContext(sim, inst, unitId, [removedId], inst.stacks), reason });
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
    applyEffects(sim, periodic.effects, { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [tickId] });
    // A tick effect may have re-applied this aura, which already restarted the chain.
    if (target.auras.get(key) === inst && inst.tick === null) scheduleTick(sim, targetId, key, inst);
  });
}

function expire(sim: Simulation, targetId: string, key: string, inst: AuraInstance): void {
  const target = sim.unit(targetId);
  if (target.auras.get(key) !== inst) return;
  sim.cancel(inst.tick);
  target.auras.delete(key);
  const removed = sim.emit(
    'aura_removed',
    { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason: 'expired' },
    [inst.appliedEvent],
  );
  const onExpire = sim.catalog.aura(inst.auraId).onExpire;
  if (onExpire) applyEffects(sim, onExpire, { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [removed] });
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
    sim.cancel(inst.expiry);
    sim.cancel(inst.tick);
    target.auras.delete(key);
    const removed = sim.emit('aura_removed', { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason }, causes);
    ids.push(removed);
    afterRemove(sim, inst, targetId, removed, reason);
  }
  return ids;
}
