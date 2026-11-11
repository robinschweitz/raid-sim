import type { Scheduled } from './queue';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Avoidance {
  readonly missPct: number;
  readonly dodgePct: number;
  readonly parryPct: number;
}

export interface MeleeStats {
  readonly minDamage: number;
  readonly maxDamage: number;
  readonly attackTimeMs: number;
}

export const NO_AVOIDANCE: Avoidance = Object.freeze({ missPct: 0, dodgePct: 0, parryPct: 0 });

export type Role = 'tank' | 'healer' | 'melee' | 'ranged' | 'boss' | 'add';

export const ID_PATTERN = /^[a-z0-9_-]+$/;

export interface Move {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly startMs: number;
  readonly speed: number;
  readonly arrivalMs: number;
  readonly handle: Scheduled;
}

export interface AuraInstance {
  readonly auraId: string;
  readonly casterId: string;
  stacks: number;
  readonly appliedMs: number;
  expiresMs: number;
  expiry: Scheduled;
  tick: Scheduled | null;
  /** Time of the next periodic tick anchor (applied + k * interval); keeps tick phase across refreshes. */
  nextTickMs: number;
  appliedEvent: string;
}

export interface CastState {
  readonly spellId: string;
  readonly targetId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly handle: Scheduled;
  startEvent: string;
}

export interface Unit {
  readonly id: string;
  readonly name: string;
  readonly kind: 'player' | 'creature';
  readonly role: Role;
  readonly approximate: boolean;
  readonly maxHealth: number;
  health: number;
  alive: boolean;
  pos: Vec2;
  move: Move | null;
  readonly speedYdPerSec: number;
  readonly combatReach: number;
  readonly boundingRadius: number;
  readonly level: number;
  readonly armor: number;
  readonly avoidance: Avoidance;
  /** Auto-attack stats; null for units that do not swing (players until Plan 3). */
  readonly melee: MeleeStats | null;
  /** Multiplier on threat from this unit's damage (stances, presences). */
  readonly threatMultiplier: number;
  /** Earliest time of the next melee swing. */
  nextSwingMs: number;
  /** Key: auraKey(auraId, casterId). */
  readonly auras: Map<string, AuraInstance>;
  cast: CastState | null;
  gcdUntilMs: number;
  /** spellId → time the spell is ready again. */
  readonly cooldowns: Map<string, number>;
  /** unitId → threat; used on creatures. */
  readonly threat: Map<string, number>;
  diedAtEvent: string | null;
}

export interface UnitInit {
  readonly id: string;
  readonly name: string;
  readonly kind: 'player' | 'creature';
  readonly role: Role;
  readonly approximate?: boolean;
  readonly maxHealth: number;
  readonly pos: Vec2;
  readonly speedYdPerSec: number;
  readonly combatReach: number;
  readonly boundingRadius: number;
  readonly level?: number;
  readonly armor?: number;
  readonly avoidance?: Avoidance;
  readonly melee?: MeleeStats | null;
  readonly threatMultiplier?: number;
}

export function createUnit(init: UnitInit): Unit {
  if (!ID_PATTERN.test(init.id)) throw new Error(`invalid unit id ${init.id}`);
  if (!Number.isInteger(init.maxHealth) || init.maxHealth <= 0) {
    throw new Error(`maxHealth of ${init.id} must be a positive integer`);
  }
  const sizeOk = (x: number): boolean => Number.isFinite(x) && x >= 0;
  if (!sizeOk(init.speedYdPerSec) || !sizeOk(init.combatReach) || !sizeOk(init.boundingRadius)) {
    throw new Error(`negative or invalid speed or size for ${init.id}`);
  }
  if (!Number.isFinite(init.pos.x) || !Number.isFinite(init.pos.y)) throw new Error(`invalid position for ${init.id}`);
  const level = init.level ?? 80;
  const armor = init.armor ?? 0;
  const avoidance = init.avoidance ?? NO_AVOIDANCE;
  const melee = init.melee ?? null;
  const threatMultiplier = init.threatMultiplier ?? 1;
  if (!Number.isInteger(level) || level < 1 || level > 83) throw new Error(`invalid level ${level} for ${init.id}`);
  if (!Number.isFinite(armor) || armor < 0) throw new Error(`invalid armor ${armor} for ${init.id}`);
  const av = [avoidance.missPct, avoidance.dodgePct, avoidance.parryPct];
  if (av.some((v) => !Number.isFinite(v) || v < 0) || av.reduce((a, b) => a + b, 0) > 100) {
    throw new Error(`invalid avoidance for ${init.id}`);
  }
  if (
    melee &&
    (!Number.isFinite(melee.minDamage) || melee.minDamage < 0 || !(melee.maxDamage >= melee.minDamage) ||
      !Number.isInteger(melee.attackTimeMs) || melee.attackTimeMs <= 0)
  ) {
    throw new Error(`invalid melee stats for ${init.id}`);
  }
  if (!Number.isFinite(threatMultiplier) || threatMultiplier < 0) throw new Error(`invalid threat multiplier for ${init.id}`);
  return {
    id: init.id,
    name: init.name,
    kind: init.kind,
    role: init.role,
    approximate: init.approximate ?? false,
    maxHealth: init.maxHealth,
    health: init.maxHealth,
    alive: true,
    pos: { x: init.pos.x, y: init.pos.y },
    move: null,
    speedYdPerSec: init.speedYdPerSec,
    combatReach: init.combatReach,
    boundingRadius: init.boundingRadius,
    level,
    armor,
    avoidance: { ...avoidance },
    melee: melee ? { ...melee } : null,
    threatMultiplier,
    nextSwingMs: 0,
    auras: new Map(),
    cast: null,
    gcdUntilMs: 0,
    cooldowns: new Map(),
    threat: new Map(),
    diedAtEvent: null,
  };
}

export const auraKey = (auraId: string, casterId: string): string => `${auraId}|${casterId}`;

/** Locale-independent string order (UTF-16 code units); the one comparator used wherever order must be deterministic. */
export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const byId = (a: { readonly id: string }, b: { readonly id: string }): number => compareStrings(a.id, b.id);
