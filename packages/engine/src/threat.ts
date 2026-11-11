import { withinMeleeRange } from './movement';
import { EventClass } from './queue';
import type { Simulation } from './sim';
import type { TraceEvent } from './trace';
import { compareStrings, type Unit } from './units';

interface Ref {
  threat: number;
  tauntSeq: number;
  tauntUntilMs: number;
}

interface Entry {
  readonly id: string;
  readonly threat: number;
  readonly taunting: boolean;
}

const managers = new WeakMap<Simulation, ThreatManager>();

/** The threat manager installed for a simulation, if any. */
export function threatFor(sim: Simulation): ThreatManager | undefined {
  return managers.get(sim);
}

/** AzerothCore-style threat (ThreatManager.cpp at the pinned commit; adaptation A-019). */
export class ThreatManager {
  private readonly lists = new Map<string, Map<string, Ref>>();
  private readonly victims = new Map<string, string>();
  private seq = 0;

  constructor(
    private readonly sim: Simulation,
    private readonly updateIntervalMs: number,
  ) {
    if (!Number.isInteger(updateIntervalMs) || updateIntervalMs <= 0) throw new Error('threat update interval must be a positive integer');
    if (managers.has(sim)) throw new Error('a threat manager is already installed for this simulation');
    managers.set(sim, this);
  }

  install(): void {
    this.sim.subscribe((ev) => this.onEvent(ev));
    const tick = (): void => {
      if (this.sim.over) return;
      for (const id of [...this.lists.keys()].sort(compareStrings)) this.reselect(id, []);
      this.sim.at(this.sim.now + this.updateIntervalMs, EventClass.AiUpdate, tick);
    };
    this.sim.at(this.sim.now + this.updateIntervalMs, EventClass.AiUpdate, tick);
  }

  /** Adds threat; the unit joins the creature's list if needed (amount 0 = zone-in-combat). */
  add(creatureId: string, unitId: string, amount: number, causes: readonly string[] = []): void {
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`invalid threat amount ${amount}`);
    const creature = this.sim.unit(creatureId);
    const unit = this.sim.unit(unitId);
    if (creature.kind !== 'creature' || unit.kind !== 'player') throw new Error(`threat goes from players onto creatures (${unitId} → ${creatureId})`);
    if (!creature.alive || !unit.alive || this.sim.over) return;
    const ref = this.refOf(creatureId, unitId);
    ref.threat += amount;
    if (!this.victimAlive(creatureId)) this.reselect(creatureId, causes);
  }

  threatOf(creatureId: string, unitId: string): number {
    return this.lists.get(creatureId)?.get(unitId)?.threat ?? 0;
  }

  /** Living units on the creature's list, sorted by id. */
  listed(creatureId: string): Unit[] {
    const list = this.lists.get(creatureId);
    if (!list) return [];
    return [...list.keys()].sort(compareStrings).map((id) => this.sim.unit(id)).filter((u) => u.alive);
  }

  victim(creatureId: string): Unit | null {
    if (!this.victimAlive(creatureId)) this.reselect(creatureId, []);
    const id = this.victims.get(creatureId);
    const unit = id ? this.sim.units.get(id) : undefined;
    return unit?.alive ? unit : null;
  }

  /**
   * Taunt (MatchUnitThreatToHighestThreat + taunt state): the taunter's threat is raised to the highest
   * threat, it takes precedence until `durationMs` ends, and the victim is reselected now and at the end.
   */
  taunt(creatureId: string, taunterId: string, durationMs: number, causes: readonly string[]): 'ok' | 'dead' | 'not_in_combat' {
    const creature = this.sim.unit(creatureId);
    const taunter = this.sim.unit(taunterId);
    if (!creature.alive || !taunter.alive || this.sim.over) return 'dead';
    const list = this.lists.get(creatureId);
    if (!list) return 'not_in_combat';
    const highest = Math.max(0, ...[...list].filter(([id]) => this.sim.unit(id).alive).map(([, r]) => r.threat));
    const ref = this.refOf(creatureId, taunterId);
    if (ref.threat < highest) ref.threat = highest;
    ref.tauntSeq = ++this.seq;
    ref.tauntUntilMs = this.sim.now + durationMs;
    const tauntEvent = this.sim.emit('taunt', { boss: creatureId, actor: taunterId, untilMs: ref.tauntUntilMs }, causes);
    this.reselect(creatureId, [tauntEvent]);
    this.sim.at(ref.tauntUntilMs, EventClass.AuraExpiry, () => this.reselect(creatureId, [tauntEvent]));
    return 'ok';
  }

  private refOf(creatureId: string, unitId: string): Ref {
    let list = this.lists.get(creatureId);
    if (!list) this.lists.set(creatureId, (list = new Map()));
    let ref = list.get(unitId);
    if (!ref) list.set(unitId, (ref = { threat: 0, tauntSeq: 0, tauntUntilMs: -1 }));
    return ref;
  }

  private victimAlive(creatureId: string): boolean {
    const id = this.victims.get(creatureId);
    return id !== undefined && this.sim.unit(id).alive;
  }

  private onEvent(ev: TraceEvent): void {
    const d = ev.data;
    if (typeof d.source !== 'string' && ev.kind !== 'death') return;
    if (ev.kind === 'damage' && typeof d.target === 'string') {
      const source = this.sim.units.get(d.source as string);
      const target = this.sim.units.get(d.target);
      const amount = Number(d.amount);
      if (!source || !target) return;
      if (source.kind === 'player' && target.kind === 'creature' && amount > 0) this.add(target.id, source.id, amount * source.threatMultiplier, [ev.id]);
    } else if (ev.kind === 'heal' && typeof d.target === 'string') {
      const healer = this.sim.units.get(d.source as string);
      const amount = Number(d.amount);
      const target = d.target;
      if (!healer || !this.sim.units.has(target) || healer.kind !== 'player' || !(amount > 0)) return;
      const threatened = [...this.lists.keys()].sort(compareStrings).filter((c) => this.lists.get(c)!.has(target) && this.sim.unit(c).alive);
      if (threatened.length === 0) return;
      const share = amount / 2 / threatened.length; // Unit.cpp 8204: half the healing, split evenly, no modifiers
      for (const c of threatened) this.add(c, healer.id, share, [ev.id]);
    } else if (ev.kind === 'death' && typeof d.unit === 'string') {
      this.lists.delete(d.unit);
      this.victims.delete(d.unit);
      for (const c of [...this.victims.keys()].sort(compareStrings)) if (this.victims.get(c) === d.unit) this.reselect(c, [ev.id]);
    }
  }

  /** Living entries, sorted: the current taunter first, then threat, then id. */
  private entries(creatureId: string): Entry[] {
    const list = this.lists.get(creatureId);
    if (!list) return [];
    const now = this.sim.now;
    let taunter: string | null = null;
    let latest = 0;
    for (const [id, r] of list) {
      if (r.tauntUntilMs > now && r.tauntSeq > latest && this.sim.unit(id).alive) {
        taunter = id;
        latest = r.tauntSeq;
      }
    }
    return [...list]
      .filter(([id]) => this.sim.unit(id).alive)
      .map(([id, r]) => ({ id, threat: r.threat, taunting: id === taunter }))
      .sort((a, b) => Number(b.taunting) - Number(a.taunting) || b.threat - a.threat || compareStrings(a.id, b.id));
  }

  /** CompareReferencesLT: is `a` lower than `b` when a's threat is multiplied by `weight`? */
  private static lower(a: Entry, b: Entry, weight: number): boolean {
    if (a.taunting !== b.taunting) return !a.taunting;
    return a.threat * weight < b.threat;
  }

  /** ReselectVictim (ThreatManager.cpp ~665), without fixate. */
  private choose(creatureId: string): string | null {
    const sorted = this.entries(creatureId);
    if (sorted.length === 0) return null;
    const creature = this.sim.unit(creatureId);
    const now = this.sim.now;
    const old = sorted.find((e) => e.id === this.victims.get(creatureId));
    const highest = sorted[0];
    if (!old || highest.id === old.id) return highest.id;
    if (!ThreatManager.lower(old, highest, 1.1)) return old.id;
    if (ThreatManager.lower(old, highest, 1.3)) return highest.id;
    const melee = (e: Entry) => withinMeleeRange(creature, this.sim.unit(e.id), now);
    if (melee(highest)) return highest.id;
    for (const next of sorted) {
      if (next.id === old.id) return old.id;
      if (!ThreatManager.lower(old, next, 1.1)) return old.id;
      if (melee(next)) return next.id;
    }
    return old.id;
  }

  private reselect(creatureId: string, causes: readonly string[]): void {
    if (!this.sim.unit(creatureId).alive || this.sim.over) return;
    const next = this.choose(creatureId);
    const previous = this.victims.get(creatureId) ?? null;
    if (next === previous) return;
    if (next === null) this.victims.delete(creatureId);
    else this.victims.set(creatureId, next);
    this.sim.emit('threat_target', { boss: creatureId, target: next, previous }, causes);
  }
}
