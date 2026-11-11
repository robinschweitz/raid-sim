import type { Simulation } from './sim';
import { ID_PATTERN } from './units';

export type School = 'physical' | 'holy' | 'fire' | 'nature' | 'frost' | 'shadow' | 'arcane';

export type Effect =
  | { readonly type: 'damage'; readonly school: School; readonly min: number; readonly max: number }
  | { readonly type: 'heal'; readonly min: number; readonly max: number }
  | { readonly type: 'apply_aura'; readonly aura: string }
  | { readonly type: 'remove_aura'; readonly aura: string }
  | { readonly type: 'taunt'; readonly durationMs: number }
  | {
      readonly type: 'area';
      readonly radius: number;
      readonly includeCenter: boolean;
      readonly filter: 'players' | 'creatures' | 'all';
      readonly effects: readonly Effect[];
    };

export interface DamageModifier {
  readonly kind: 'damage_done_pct' | 'damage_taken_pct';
  /** Percent change, e.g. -25 for 25 % less. */
  readonly pct: number;
  /** Multiply the percentage by the aura's stacks. */
  readonly perStack: boolean;
  /** Limit to these schools; all schools when absent. */
  readonly schools?: readonly School[];
}

export type AuraRemoveReason = 'expired' | 'removed' | 'dispelled';

export interface AuraHookContext {
  readonly sim: Simulation;
  readonly unitId: string;
  readonly casterId: string;
  readonly auraId: string;
  readonly stacks: number;
  /** Stacks before this event: 0 on apply; equal to `stacks` when re-applied at max stacks and in afterRemove. */
  readonly previousStacks: number;
  readonly appliedMs: number;
  readonly refreshedMs: number;
  readonly causes: readonly string[];
}

/**
 * Hooks are not called when the unit holding the aura (or, for a spell script, the spell's target) is dead at that
 * moment. afterStack also fires when the aura is re-applied at max stacks (stacks unchanged, duration refreshed).
 */
export interface AuraScript {
  afterApply?(ctx: AuraHookContext): void;
  afterStack?(ctx: AuraHookContext): void;
  /** Not called when the aura is removed by death (A-012), nor when the holder is dead (e.g. killed by onExpire). */
  afterRemove?(ctx: AuraHookContext & { readonly reason: AuraRemoveReason }): void;
}

export interface SpellHitContext {
  readonly sim: Simulation;
  readonly spellId: string;
  readonly casterId: string;
  readonly targetId: string;
  readonly causes: readonly string[];
}

export interface SpellScript {
  /** Runs after all effects of the spell were applied to the target (A-024); skipped if the target died. */
  afterHitTarget?(ctx: SpellHitContext): void;
}

export interface AuraDef {
  readonly id: string;
  /** Milliseconds, or null for a permanent aura. */
  readonly durationMs: number | null;
  readonly maxStacks: number;
  /** 'caster' (default): one instance per caster; 'unit': one instance per unit, any caster stacks it. */
  readonly stackScope?: 'caster' | 'unit';
  readonly periodic?: { readonly intervalMs: number; readonly effects: readonly Effect[] };
  readonly onExpire?: readonly Effect[];
  readonly modifiers?: readonly DamageModifier[];
}

export interface SpellDef {
  readonly id: string;
  readonly castTimeMs: number;
  readonly gcdMs: number;
  readonly cooldownMs: number;
  readonly rangeYd: number;
  readonly usableWhileMoving: boolean;
  readonly target: 'self' | 'unit';
  readonly travelSpeedYdPerSec?: number;
  readonly effects: readonly Effect[];
}

export class Catalog {
  private readonly spells = new Map<string, SpellDef>();
  private readonly auras = new Map<string, AuraDef>();
  private readonly auraScripts = new Map<string, AuraScript>();
  private readonly spellScripts = new Map<string, SpellScript>();

  addSpell(def: SpellDef): void {
    if (!ID_PATTERN.test(def.id)) throw new Error(`invalid spell id ${def.id}`);
    if (this.spells.has(def.id)) throw new Error(`duplicate spell ${def.id}`);
    if (def.castTimeMs < 0 || def.gcdMs < 0 || def.cooldownMs < 0 || def.rangeYd < 0) {
      throw new Error(`negative timing or range in spell ${def.id}`);
    }
    this.spells.set(def.id, def);
  }

  addAura(def: AuraDef): void {
    if (!ID_PATTERN.test(def.id)) throw new Error(`invalid aura id ${def.id}`);
    if (this.auras.has(def.id)) throw new Error(`duplicate aura ${def.id}`);
    if ((def.durationMs !== null && !(def.durationMs > 0)) || !Number.isInteger(def.maxStacks) || def.maxStacks < 1) {
      throw new Error(`aura ${def.id} needs a positive duration or null (permanent), and maxStacks >= 1`);
    }
    if (def.periodic && def.periodic.intervalMs <= 0) throw new Error(`aura ${def.id} needs a positive tick interval`);
    for (const m of def.modifiers ?? []) {
      if (!Number.isFinite(m.pct)) throw new Error(`aura ${def.id} has a non-finite modifier percentage`);
    }
    this.auras.set(def.id, def);
  }

  addAuraScript(auraId: string, script: AuraScript): void {
    this.aura(auraId);
    if (this.auraScripts.has(auraId)) throw new Error(`duplicate aura script ${auraId}`);
    this.auraScripts.set(auraId, script);
  }

  addSpellScript(spellId: string, script: SpellScript): void {
    this.spell(spellId);
    if (this.spellScripts.has(spellId)) throw new Error(`duplicate spell script ${spellId}`);
    this.spellScripts.set(spellId, script);
  }

  auraScript(auraId: string): AuraScript | undefined {
    return this.auraScripts.get(auraId);
  }

  spellScript(spellId: string): SpellScript | undefined {
    return this.spellScripts.get(spellId);
  }

  spell(id: string): SpellDef {
    const s = this.spells.get(id);
    if (!s) throw new Error(`unknown spell ${id}`);
    return s;
  }

  aura(id: string): AuraDef {
    const a = this.auras.get(id);
    if (!a) throw new Error(`unknown aura ${id}`);
    return a;
  }

  hasSpell(id: string): boolean {
    return this.spells.has(id);
  }

  hasAura(id: string): boolean {
    return this.auras.has(id);
  }
}
