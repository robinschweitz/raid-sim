/** Order of event classes at the same millisecond (spec §8.2, adaptation A-001). */
export enum EventClass {
  SpellHit = 0,
  PeriodicTick = 1,
  AuraExpiry = 2,
  AiUpdate = 3,
  Decision = 4,
}

export interface Scheduled {
  readonly time: number;
  readonly cls: EventClass;
  readonly seq: number;
  cancelled: boolean;
  readonly run: () => void;
}

function before(a: Scheduled, b: Scheduled): boolean {
  if (a.time !== b.time) return a.time < b.time;
  if (a.cls !== b.cls) return a.cls < b.cls;
  return a.seq < b.seq;
}

export class EventQueue {
  private readonly heap: Scheduled[] = [];
  private seq = 0;

  push(time: number, cls: EventClass, run: () => void): Scheduled {
    if (!Number.isInteger(time) || time < 0) throw new Error(`invalid event time ${time}`);
    const item: Scheduled = { time, cls, seq: this.seq++, cancelled: false, run };
    this.heap.push(item);
    this.up(this.heap.length - 1);
    return item;
  }

  cancel(item: Scheduled): void {
    item.cancelled = true;
  }

  peek(): Scheduled | undefined {
    this.dropCancelled();
    return this.heap[0];
  }

  pop(): Scheduled | undefined {
    this.dropCancelled();
    return this.take();
  }

  get size(): number {
    return this.heap.filter((i) => !i.cancelled).length;
  }

  private dropCancelled(): void {
    while (this.heap.length > 0 && this.heap[0].cancelled) this.take();
  }

  private take(): Scheduled | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.down(0);
    }
    return top;
  }

  private swap(i: number, j: number): void {
    const t = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = t;
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(this.heap[i], this.heap[p])) return;
      this.swap(i, p);
      i = p;
    }
  }

  private down(i: number): void {
    const n = this.heap.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && before(this.heap[l], this.heap[m])) m = l;
      if (r < n && before(this.heap[r], this.heap[m])) m = r;
      if (m === i) return;
      this.swap(i, m);
      i = m;
    }
  }
}
