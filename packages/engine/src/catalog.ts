import { ID_PATTERN } from './units';

export type School = 'physical' | 'holy' | 'fire' | 'nature' | 'frost' | 'shadow' | 'arcane';

export type Effect =
  | { readonly type: 'damage'; readonly school: School; readonly min: number; readonly max: number }
  | { readonly type: 'heal'; readonly min: number; readonly max: number }
  | { readonly type: 'apply_aura'; readonly aura: string }
  | { readonly type: 'remove_aura'; readonly aura: string }
  | {
      readonly type: 'area';
      readonly radius: number;
      readonly includeCenter: boolean;
      readonly filter: 'players' | 'creatures' | 'all';
      readonly effects: readonly Effect[];
    };

export interface AuraDef {
  readonly id: string;
  readonly durationMs: number;
  readonly maxStacks: number;
  readonly periodic?: { readonly intervalMs: number; readonly effects: readonly Effect[] };
  readonly onExpire?: readonly Effect[];
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
    if (def.durationMs <= 0 || !Number.isInteger(def.maxStacks) || def.maxStacks < 1) {
      throw new Error(`aura ${def.id} needs a positive duration and maxStacks >= 1`);
    }
    if (def.periodic && def.periodic.intervalMs <= 0) throw new Error(`aura ${def.id} needs a positive tick interval`);
    this.auras.set(def.id, def);
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
