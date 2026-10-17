import { cyrb128 } from "../util/hash";

/**
 * Seeded PRNG (sfc32). Each generator step forks its own named stream,
 * so adding draws in one step never shifts the draws of another.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(readonly seed: string) {
    [this.a, this.b, this.c, this.d] = cyrb128(seed);
    for (let i = 0; i < 12; i++) this.next();
  }

  /** A new independent stream named under this one. */
  fork(label: string): Rng {
    return new Rng(`${this.seed}/${label}`);
  }

  /** Float in [0, 1). */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Integer in [min, max], both ends included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(r: readonly [number, number]): number {
    return this.int(r[0], r[1]);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from empty list");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Pick a key from a { key: weight } map. Keys are read in insertion order. */
  weighted<K extends string>(weights: Readonly<Record<K, number>>): K {
    const entries = Object.entries(weights) as [K, number][];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [key, w] of entries) {
      roll -= w;
      if (roll < 0) return key;
    }
    return (entries[entries.length - 1] as [K, number])[0];
  }

  pickWeighted<T extends { weight: number }>(items: readonly T[]): T {
    const total = items.reduce((sum, i) => sum + i.weight, 0);
    let roll = this.next() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll < 0) return item;
    }
    return items[items.length - 1] as T;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  hex(len: number): string {
    let s = "";
    for (let i = 0; i < len; i++) s += Math.floor(this.next() * 16).toString(16);
    return s;
  }

  digits(len: number): string {
    let s = "";
    for (let i = 0; i < len; i++) s += Math.floor(this.next() * 10).toString();
    return s;
  }
}
