import type { Rng } from './rng';

interface Entry {
  readonly at: number;
  readonly id: number;
  readonly groupMask: number;
  readonly phaseMask: number;
}

function bit(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > 31) throw new Error(`invalid group or phase index ${index}`);
  return index === 0 ? 0 : 1 << (index - 1);
}

/**
 * Counterpart of AzerothCore's EventMap (src/common/Utilities/EventMap.cpp at the pinned commit).
 * Times are milliseconds since the map was created or reset.
 */
export class EventMap {
  private time = 0;
  private entries: Entry[] = [];
  private phaseMask = 0;
  private last: Entry | null = null;

  constructor(private readonly rng: Rng) {}

  get now(): number {
    return this.time;
  }

  update(diffMs: number): void {
    this.time += diffMs;
  }

  reset(): void {
    this.entries = [];
    this.time = 0;
    this.phaseMask = 0;
    this.last = null;
  }

  setPhase(phase: number): void {
    this.phaseMask = bit(phase);
  }

  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  schedule(id: number, delayMs: number, group = 0, phase = 0): void {
    this.insert({ at: this.time + delayMs, id, groupMask: bit(group), phaseMask: bit(phase) });
  }

  scheduleRange(id: number, minMs: number, maxMs: number, group = 0, phase = 0): void {
    this.schedule(id, this.rng.int(minMs, maxMs), group, phase);
  }

  reschedule(id: number, delayMs: number, group = 0, phase = 0): void {
    this.cancel(id);
    this.schedule(id, delayMs, group, phase);
  }

  rescheduleRange(id: number, minMs: number, maxMs: number, group = 0, phase = 0): void {
    this.cancel(id);
    this.scheduleRange(id, minMs, maxMs, group, phase);
  }

  repeat(delayMs: number): void {
    if (!this.last) throw new Error('repeat() called before any event executed');
    this.insert({ ...this.last, at: this.time + delayMs });
  }

  repeatRange(minMs: number, maxMs: number): void {
    this.repeat(this.rng.int(minMs, maxMs));
  }

  cancel(id: number): void {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  cancelGroup(group: number): void {
    if (group === 0) return;
    const m = bit(group);
    this.entries = this.entries.filter((e) => (e.groupMask & m) === 0);
  }

  /**
   * GetTimeUntilEvent (EventMap.cpp 200–207): milliseconds until the earliest scheduled event with this id, or null when
   * none is scheduled (AzerothCore returns Milliseconds::max()). An event that is due but not yet executed gives 0 or less.
   */
  timeUntilEvent(id: number): number | null {
    // Entries are kept sorted by time, so the first match is the earliest.
    const e = this.entries.find((x) => x.id === id);
    return e ? e.at - this.time : null;
  }

  /** HasTimeUntilEvent (EventMap.cpp 209–212). */
  hasTimeUntilEvent(id: number): boolean {
    return this.timeUntilEvent(id) !== null;
  }

  /** Shifts every event (group 0) or the events of one group by delayMs. */
  delayEvents(delayMs: number, group = 0): void {
    const m = bit(group);
    const moved: Entry[] = [];
    const kept: Entry[] = [];
    for (const e of this.entries) {
      if (group === 0 || (e.groupMask & m) !== 0) moved.push({ ...e, at: e.at + delayMs });
      else kept.push(e);
    }
    this.entries = kept;
    for (const e of moved) this.insert(e);
  }

  /**
   * Events of `group` (every event if 0) due before now+delay are moved to now+delay.
   * Like AzerothCore, a moved event keeps only `group` as its group and loses its phase.
   */
  delayEventsToMax(delayMs: number, group = 0): void {
    const m = bit(group);
    const limit = this.time + delayMs;
    const moved: number[] = [];
    this.entries = this.entries.filter((e) => {
      const hit = e.at < limit && (group === 0 || (e.groupMask & m) !== 0);
      if (hit) moved.push(e.id);
      return !hit;
    });
    for (const id of moved) this.schedule(id, delayMs, group);
  }

  /** The id of one due event, or 0. Due events of a non-matching phase are discarded. */
  execute(): number {
    while (this.entries.length > 0) {
      const e = this.entries[0];
      if (e.at > this.time) return 0;
      this.entries.shift();
      if (this.phaseMask !== 0 && e.phaseMask !== 0 && (e.phaseMask & this.phaseMask) === 0) continue;
      this.last = e;
      return e.id;
    }
    return 0;
  }

  private insert(e: Entry): void {
    let i = this.entries.length;
    while (i > 0 && this.entries[i - 1].at > e.at) i--;
    this.entries.splice(i, 0, e);
  }
}
