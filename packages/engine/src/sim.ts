import { Catalog, type School } from './catalog';
import { positionAt, travelTimeMs } from './movement';
import { EventClass, EventQueue, type Scheduled } from './queue';
import { RngRegistry } from './rng';
import { TraceWriter, type EventKind, type TraceEvent, type TraceValue, type UnitSnapshot } from './trace';
import { byId, createUnit, type Unit, type UnitInit, type Vec2 } from './units';

export type OutcomeKind = 'kill' | 'wipe' | 'timeout';

export interface Outcome {
  readonly kind: OutcomeKind;
  readonly atMs: number;
  readonly event: string;
}

export interface TimerWindow {
  readonly boss: string;
  readonly ability: string;
  readonly earliestMs: number;
  readonly latestMs: number;
}

export interface SimOptions {
  readonly seed: number;
  readonly maxDurationMs: number;
  readonly sampleIntervalMs: number;
}

export interface HitInfo {
  readonly sourceId: string;
  readonly ability: string;
  readonly school: School;
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Simulation {
  now = 0;
  phase = 'default';
  outcome: Outcome | null = null;
  readonly queue = new EventQueue();
  readonly rng: RngRegistry;
  readonly trace = new TraceWriter();
  readonly catalog = new Catalog();
  readonly units = new Map<string, Unit>();
  /** Boss-mod style timer windows, keyed `${boss}|${ability}`; visible to actors (§8.6). */
  readonly timerWindows = new Map<string, TimerWindow>();
  private readonly listeners: Array<(ev: TraceEvent) => void> = [];
  private nextSampleMs = 0;
  private lastSampleMs = -1;
  private ending = false;
  private readonly killed = new Set<string>();

  constructor(readonly options: SimOptions) {
    if (!Number.isInteger(options.sampleIntervalMs) || options.sampleIntervalMs <= 0) {
      throw new Error('sampleIntervalMs must be a positive integer');
    }
    if (!Number.isInteger(options.maxDurationMs) || options.maxDurationMs <= 0) {
      throw new Error('maxDurationMs must be a positive integer');
    }
    this.rng = new RngRegistry(options.seed);
  }

  addUnit(init: UnitInit): Unit {
    if (this.units.has(init.id)) throw new Error(`duplicate unit id ${init.id}`);
    const u = createUnit(init);
    this.units.set(u.id, u);
    return u;
  }

  unit(id: string): Unit {
    const u = this.units.get(id);
    if (!u) throw new Error(`unknown unit ${id}`);
    return u;
  }

  sortedUnits(filter: (u: Unit) => boolean = () => true): Unit[] {
    return [...this.units.values()].filter(filter).sort(byId);
  }

  bosses(): Unit[] {
    return this.sortedUnits((u) => u.role === 'boss');
  }

  players(): Unit[] {
    return this.sortedUnits((u) => u.kind === 'player');
  }

  subscribe(listener: (ev: TraceEvent) => void): void {
    this.listeners.push(listener);
  }

  emit(kind: EventKind, data: Readonly<Record<string, TraceValue>>, causes: readonly string[] = []): string {
    const ev = this.trace.emit(this.now, kind, data, causes);
    for (const listener of [...this.listeners]) listener(ev);
    return ev.id;
  }

  at(timeMs: number, cls: EventClass, run: () => void): Scheduled {
    if (timeMs < this.now) throw new Error(`cannot schedule at ${timeMs} before now (${this.now})`);
    return this.queue.push(timeMs, cls, run);
  }

  cancel(item: Scheduled | null): void {
    if (item) this.queue.cancel(item);
  }

  /** Applies damage; returns the damage event id, or null if the target is dead or the fight is over. */
  damage(targetId: string, amount: number, info: HitInfo, causes: readonly string[]): string | null {
    const u = this.unit(targetId);
    if (!Number.isFinite(amount)) throw new Error(`invalid amount ${amount} for damage to ${targetId}`);
    if (!u.alive || this.outcome || this.ending) return null;
    const rounded = Math.max(0, Math.round(amount));
    const dealt = Math.min(u.health, rounded);
    u.health -= dealt;
    // Decide lethality before listeners run so they cannot heal or re-kill the unit.
    const lethal = u.health <= 0;
    if (lethal) u.alive = false;
    const id = this.emit(
      'damage',
      { target: u.id, source: info.sourceId, ability: info.ability, school: info.school, amount: dealt, overkill: rounded - dealt },
      causes,
    );
    if (lethal) this.kill(u, id);
    return id;
  }

  /** Applies healing; a dead target is not healed and no event is written (A-008). */
  heal(targetId: string, amount: number, info: HitInfo, causes: readonly string[]): string | null {
    const u = this.unit(targetId);
    if (!Number.isFinite(amount)) throw new Error(`invalid amount ${amount} for heal to ${targetId}`);
    if (!u.alive || this.outcome || this.ending) return null;
    const rounded = Math.max(0, Math.round(amount));
    const effective = Math.min(u.maxHealth - u.health, rounded);
    u.health += effective;
    return this.emit(
      'heal',
      { target: u.id, source: info.sourceId, ability: info.ability, amount: effective, overheal: rounded - effective },
      causes,
    );
  }

  startMove(unitId: string, to: Vec2, causes: readonly string[]): string {
    const u = this.unit(unitId);
    if (!u.alive) throw new Error(`dead unit ${unitId} cannot move`);
    if (u.speedYdPerSec <= 0) throw new Error(`unit ${unitId} cannot move (speed 0)`);
    if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) throw new Error(`invalid move target for ${unitId}`);
    const target: Vec2 = { x: to.x, y: to.y };
    const from = positionAt(u, this.now);
    const arrivalMs = this.now + travelTimeMs(from, target, u.speedYdPerSec);
    if (u.move) this.cancel(u.move.handle);
    let startEvent = '';
    const handle = this.at(arrivalMs, EventClass.Decision, () => {
      u.pos = target;
      u.move = null;
      this.emit('move_end', { unit: u.id, x: r3(target.x), y: r3(target.y), stopped: false }, [startEvent]);
    });
    u.pos = from;
    u.move = { from, to: target, startMs: this.now, speed: u.speedYdPerSec, arrivalMs, handle };
    startEvent = this.emit(
      'move_start',
      { unit: u.id, fromX: r3(from.x), fromY: r3(from.y), toX: r3(target.x), toY: r3(target.y), arrivalMs },
      causes,
    );
    return startEvent;
  }

  stopMove(unitId: string, causes: readonly string[]): string | null {
    const u = this.unit(unitId);
    if (!u.move) return null;
    const p = positionAt(u, this.now);
    this.cancel(u.move.handle);
    u.pos = p;
    u.move = null;
    return this.emit('move_end', { unit: u.id, x: r3(p.x), y: r3(p.y), stopped: true }, causes);
  }

  run(): Outcome {
    if (this.outcome) return this.outcome;
    const max = this.options.maxDurationMs;
    let result: Outcome | null = null;
    for (;;) {
      const next = this.queue.peek();
      const horizon = Math.min(next ? next.time : Number.POSITIVE_INFINITY, max + 1);
      while (this.nextSampleMs < horizon) {
        this.sample(this.nextSampleMs);
        this.nextSampleMs += this.options.sampleIntervalMs;
      }
      if (!next || next.time > max) {
        this.now = Math.max(this.now, max);
        result = this.finish('timeout', []);
        break;
      }
      this.queue.pop();
      this.now = next.time;
      next.run();
      if (this.outcome) {
        result = this.outcome;
        break;
      }
    }
    if (this.lastSampleMs !== this.now) this.sample(this.now);
    if (!result) throw new Error('simulation ended without an outcome');
    return result;
  }

  private kill(u: Unit, cause: string): void {
    if (this.killed.has(u.id)) return;
    this.killed.add(u.id);
    u.alive = false;
    u.health = 0;
    if (u.cast) {
      this.cancel(u.cast.handle);
      u.cast = null;
    }
    if (u.move) {
      u.pos = positionAt(u, this.now);
      this.cancel(u.move.handle);
      u.move = null;
    }
    const deathId = this.emit('death', { unit: u.id }, [cause]);
    u.diedAtEvent = deathId;
    for (const key of [...u.auras.keys()].sort(byString)) {
      const a = u.auras.get(key)!;
      this.cancel(a.expiry);
      this.cancel(a.tick);
      u.auras.delete(key);
      this.emit('aura_removed', { unit: u.id, aura: a.auraId, caster: a.casterId, reason: 'death' }, [deathId]);
    }
    this.checkOutcome(deathId);
  }

  private checkOutcome(cause: string): void {
    if (this.outcome || this.ending) return;
    const bosses = this.bosses();
    const players = this.players();
    if (bosses.length > 0 && bosses.every((b) => !b.alive)) this.finish('kill', [cause]);
    else if (players.length > 0 && players.every((p) => !p.alive)) this.finish('wipe', [cause]);
  }

  private finish(kind: OutcomeKind, causes: readonly string[]): Outcome {
    this.ending = true;
    const event = this.emit('outcome', { kind }, causes);
    const outcome: Outcome = { kind, atMs: this.now, event };
    this.outcome = outcome;
    return outcome;
  }

  private sample(t: number): void {
    const units: UnitSnapshot[] = this.sortedUnits().map((u) => {
      const p = positionAt(u, t);
      const auras = [...u.auras.values()]
        .map((a) => [a.auraId, a.stacks] as const)
        .sort((a, b) => byString(a[0], b[0]) || a[1] - b[1]);
      return { id: u.id, x: r3(p.x), y: r3(p.y), health: u.health, alive: u.alive, auras, cast: u.cast ? u.cast.spellId : null };
    });
    this.trace.snapshot({ t, units });
    this.lastSampleMs = t;
  }
}
