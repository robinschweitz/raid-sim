import { checkCast, type CastCheck } from './casting';
import { positionAt } from './movement';
import type { Simulation, TimerWindow } from './sim';
import type { Role, Unit, Vec2 } from './units';

export interface AuraView {
  readonly aura: string;
  readonly caster: string;
  readonly stacks: number;
  readonly remainingMs: number;
}

export interface CastView {
  readonly spell: string;
  readonly target: string;
  readonly endsAtMs: number;
}

export interface UnitView {
  readonly id: string;
  readonly name: string;
  readonly kind: 'player' | 'creature';
  readonly role: Role;
  readonly health: number;
  readonly maxHealth: number;
  readonly alive: boolean;
  readonly x: number;
  readonly y: number;
  readonly moving: boolean;
  readonly combatReach: number;
  readonly auras: readonly AuraView[];
  readonly cast: CastView | null;
}

/** Everything an actor may know (§8.6). */
export interface ActorView {
  readonly now: number;
  readonly self: UnitView;
  readonly units: readonly UnitView[];
  readonly spots: Readonly<Record<string, Vec2>>;
  readonly assignment: string | null;
  readonly timers: readonly TimerWindow[];
  readonly gcdReadyAtMs: number;
  readonly cooldownReadyAtMs: Readonly<Record<string, number>>;
  canCast(spellId: string, targetId: string): CastCheck;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function unitView(u: Unit, now: number): UnitView {
  const p = positionAt(u, now);
  const auras = [...u.auras.values()]
    .map((a) => Object.freeze({ aura: a.auraId, caster: a.casterId, stacks: a.stacks, remainingMs: a.expiresMs - now }))
    .sort((a, b) => byString(a.aura, b.aura) || byString(a.caster, b.caster));
  return Object.freeze({
    id: u.id,
    name: u.name,
    kind: u.kind,
    role: u.role,
    health: u.health,
    maxHealth: u.maxHealth,
    alive: u.alive,
    x: p.x,
    y: p.y,
    moving: u.move !== null,
    combatReach: u.combatReach,
    auras: Object.freeze(auras),
    cast: u.cast ? Object.freeze({ spell: u.cast.spellId, target: u.cast.targetId, endsAtMs: u.cast.endMs }) : null,
  });
}

export function buildView(
  sim: Simulation,
  selfId: string,
  spots: Readonly<Record<string, Vec2>>,
  assignment: string | null,
): ActorView {
  const now = sim.now;
  const units = sim.sortedUnits().map((u) => unitView(u, now));
  const self = units.find((u) => u.id === selfId);
  if (!self) throw new Error(`unknown actor ${selfId}`);
  const me = sim.unit(selfId);
  const cooldowns: Record<string, number> = {};
  for (const id of [...me.cooldowns.keys()].sort(byString)) cooldowns[id] = me.cooldowns.get(id)!;
  const timers = [...sim.timerWindows.values()]
    .sort((a, b) => byString(a.boss, b.boss) || byString(a.ability, b.ability))
    .map((t) => Object.freeze({ ...t }));
  return Object.freeze({
    now,
    self,
    units: Object.freeze(units),
    spots: Object.freeze({ ...spots }),
    assignment,
    timers: Object.freeze(timers),
    gcdReadyAtMs: me.gcdUntilMs,
    cooldownReadyAtMs: Object.freeze(cooldowns),
    canCast: (spellId: string, targetId: string) => checkCast(sim, selfId, spellId, targetId),
  });
}
