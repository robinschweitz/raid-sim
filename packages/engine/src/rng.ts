import { byId } from './units';

const STREAM_NAME = /^[a-z0-9_.:-]+$/;

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Throws unless `name` is a valid random stream name. */
export function assertStreamName(name: string): void {
  if (!STREAM_NAME.test(name)) throw new Error(`invalid stream name: ${name}`);
}

/** mulberry32 generator. */
export class Rng {
  private state: number;
  private count = 0;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  nextU32(): number {
    this.count++;
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** Inclusive on both ends, like AzerothCore's urand. */
  int(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) throw new Error(`invalid range ${min}..${max}`);
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** Up to n items. The result depends only on the set of ids and the stream state, not on input order. */
  pick<T extends { readonly id: string }>(items: readonly T[], n: number): T[] {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`invalid pick count ${n}`);
    const pool = [...items].sort(byId);
    const k = Math.min(n, pool.length);
    for (let i = 0; i < k; i++) {
      const j = this.int(i, pool.length - 1);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, k);
  }

  get draws(): number {
    return this.count;
  }
}

export class RngRegistry {
  private readonly streams = new Map<string, Rng>();

  constructor(private readonly seed: number) {
    if (!Number.isInteger(seed) || seed < 0) throw new Error(`seed must be a non-negative integer, got ${seed}`);
  }

  stream(name: string): Rng {
    assertStreamName(name);
    let s = this.streams.get(name);
    if (!s) {
      s = new Rng(fnv1a(`${this.seed}|${name}`));
      this.streams.set(name, s);
    }
    return s;
  }

  usage(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of [...this.streams.keys()].sort()) out[name] = this.streams.get(name)!.draws;
    return out;
  }
}
