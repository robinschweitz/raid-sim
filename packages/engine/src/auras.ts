import { applyEffects } from './effects';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import { auraKey, type AuraInstance } from './units';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Applies or stacks an aura; returns the event id, or null if the target is dead. */
export function applyAura(
  sim: Simulation,
  auraId: string,
  casterId: string,
  targetId: string,
  causes: readonly string[],
): string | null {
  const def = sim.catalog.aura(auraId);
  const target = sim.unit(targetId);
  if (!target.alive) return null;
  const key = auraKey(auraId, casterId);
  const expiresMs = sim.now + def.durationMs;
  const existing = target.auras.get(key);
  if (existing) {
    existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
    sim.cancel(existing.expiry);
    existing.expiresMs = expiresMs;
    existing.expiry = sim.at(expiresMs, EventClass.AuraExpiry, () => expire(sim, targetId, key));
    const id = sim.emit(
      'aura_stack',
      { unit: targetId, aura: auraId, caster: casterId, stacks: existing.stacks, expiresMs },
      causes,
    );
    if (def.periodic && existing.tick === null && target.auras.get(key) === existing) scheduleTick(sim, targetId, key, existing);
    return id;
  }
  const inst: AuraInstance = {
    auraId,
    casterId,
    stacks: 1,
    appliedMs: sim.now,
    expiresMs,
    expiry: sim.at(expiresMs, EventClass.AuraExpiry, () => expire(sim, targetId, key)),
    tick: null,
    appliedEvent: '',
  };
  target.auras.set(key, inst);
  inst.appliedEvent = sim.emit('aura_applied', { unit: targetId, aura: auraId, caster: casterId, stacks: 1, expiresMs }, causes);
  if (def.periodic && target.auras.get(key) === inst) scheduleTick(sim, targetId, key, inst);
  return inst.appliedEvent;
}

function scheduleTick(sim: Simulation, targetId: string, key: string, inst: AuraInstance): void {
  const periodic = sim.catalog.aura(inst.auraId).periodic;
  if (!periodic) return;
  const at = sim.now + periodic.intervalMs;
  if (at > inst.expiresMs) {
    inst.tick = null;
    return;
  }
  inst.tick = sim.at(at, EventClass.PeriodicTick, () => {
    inst.tick = null;
    const target = sim.unit(targetId);
    if (target.auras.get(key) !== inst) return;
    const tickId = sim.emit(
      'periodic_tick',
      { unit: targetId, aura: inst.auraId, caster: inst.casterId, stacks: inst.stacks },
      [inst.appliedEvent],
    );
    applyEffects(sim, periodic.effects, { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [tickId] });
    if (target.auras.get(key) === inst) scheduleTick(sim, targetId, key, inst);
  });
}

function expire(sim: Simulation, targetId: string, key: string): void {
  const target = sim.unit(targetId);
  const inst = target.auras.get(key);
  if (!inst) return;
  sim.cancel(inst.tick);
  target.auras.delete(key);
  const removed = sim.emit(
    'aura_removed',
    { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason: 'expired' },
    [inst.appliedEvent],
  );
  const onExpire = sim.catalog.aura(inst.auraId).onExpire;
  if (onExpire) applyEffects(sim, onExpire, { casterId: inst.casterId, targetId, ability: inst.auraId, causes: [removed] });
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
  for (const key of [...target.auras.keys()].sort(byString)) {
    const inst = target.auras.get(key)!;
    if (inst.auraId !== auraId) continue;
    sim.cancel(inst.expiry);
    sim.cancel(inst.tick);
    target.auras.delete(key);
    ids.push(sim.emit('aura_removed', { unit: targetId, aura: inst.auraId, caster: inst.casterId, reason }, causes));
  }
  return ids;
}
