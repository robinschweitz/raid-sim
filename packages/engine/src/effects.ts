import { applyAura, removeAuras } from './auras';
import type { Effect } from './catalog';
import { pointToEdge, positionAt } from './movement';
import type { Simulation } from './sim';
import { threatFor } from './threat';
import type { Unit } from './units';

export interface EffectContext {
  readonly casterId: string;
  readonly targetId: string;
  readonly ability: string;
  readonly causes: readonly string[];
}

function matchesFilter(filter: 'players' | 'creatures' | 'all', u: Unit): boolean {
  if (filter === 'all') return true;
  return filter === 'players' ? u.kind === 'player' : u.kind === 'creature';
}

export function applyEffects(sim: Simulation, effects: readonly Effect[], ctx: EffectContext): void {
  for (const e of effects) applyEffect(sim, e, ctx);
}

function applyEffect(sim: Simulation, e: Effect, ctx: EffectContext): void {
  const target = sim.unit(ctx.targetId);
  switch (e.type) {
    case 'damage': {
      if (!target.alive) return;
      const amount = sim.rng.stream(`unit:${ctx.casterId}.amount`).int(e.min, e.max);
      sim.damage(target.id, amount, { sourceId: ctx.casterId, ability: ctx.ability, school: e.school }, ctx.causes);
      return;
    }
    case 'heal': {
      if (!target.alive) return;
      const amount = sim.rng.stream(`unit:${ctx.casterId}.amount`).int(e.min, e.max);
      sim.heal(target.id, amount, { sourceId: ctx.casterId, ability: ctx.ability, school: 'holy' }, ctx.causes);
      return;
    }
    case 'apply_aura':
      applyAura(sim, e.aura, ctx.casterId, target.id, ctx.causes);
      return;
    case 'remove_aura':
      removeAuras(sim, target.id, e.aura, 'removed', ctx.causes);
      return;
    case 'taunt':
      threatFor(sim)?.taunt(target.id, ctx.casterId, e.durationMs, ctx.causes);
      return;
    case 'area': {
      const center = positionAt(target, sim.now);
      const hit = sim.sortedUnits(
        (u) =>
          u.alive &&
          (e.includeCenter || u.id !== target.id) &&
          matchesFilter(e.filter, u) &&
          pointToEdge(center, u, sim.now) <= e.radius,
      );
      for (const u of hit) applyEffects(sim, e.effects, { ...ctx, targetId: u.id });
      return;
    }
  }
}
