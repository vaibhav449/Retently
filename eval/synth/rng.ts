import { createHash } from "node:crypto";

/**
 * SHA-256 of the parts, joined by a separator no part contains. Every seed and id of the generator
 * comes from here, so the same inputs always give the same cohort (V7).
 */
export function digest(...parts: readonly (string | number)[]): Buffer {
  return createHash("sha256").update(parts.map(String).join("\u0000")).digest();
}

/**
 * A seeded pseudo-random stream: sfc32 (Chris Doty-Humphrey's Small Fast Counter), 128 bits of
 * state from digest(...labels). Not for cryptography; only for reproducible simulations. One
 * stream per purpose (a student's profile, one day of one student, ...), so adding a draw in one
 * place does not shift every number after it elsewhere.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(...labels: readonly (string | number)[]) {
    const seed = digest(...labels);
    this.a = seed.readUInt32LE(0);
    this.b = seed.readUInt32LE(4);
    this.c = seed.readUInt32LE(8);
    this.d = seed.readUInt32LE(12);
    // Mix the state before the first output, as the reference implementation does.
    for (let i = 0; i < 12; i++) this.uint32();
  }

  /** The next 32-bit unsigned integer. */
  uint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform on [0, 1). */
  next(): number {
    return this.uint32() / 4_294_967_296;
  }

  /** Uniform on [low, high). */
  uniform(low: number, high: number): number {
    return low + (high - low) * this.next();
  }

  /** A uniform integer from `low` to `high`, both included. */
  int(low: number, high: number): number {
    return low + Math.floor(this.next() * (high - low + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** N(mean, sd²), by Box–Muller. One draw per call, so the stream stays easy to reason about. */
  normal(mean = 0, sd = 1): number {
    const u = 1 - this.next(); // (0, 1], so the log is finite
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** exp(N(mu, sigma²)). */
  logNormal(mu: number, sigma: number): number {
    return Math.exp(this.normal(mu, sigma));
  }

  /** Gamma(shape, 1), by Marsaglia and Tsang (shape ≥ 1). */
  gamma(shape: number): number {
    if (shape < 1) throw new RangeError("gamma: shape must be at least 1");
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const x = this.normal();
      const v = (1 + c * x) ** 3;
      if (v <= 0) continue;
      const u = this.next();
      if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
    }
  }

  /** Beta(alpha, beta), as X / (X + Y) of two gamma draws. */
  beta(alpha: number, beta: number): number {
    const x = this.gamma(alpha);
    return x / (x + this.gamma(beta));
  }

  /** One element, uniformly. */
  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new RangeError("pick: no items");
    return item;
  }

  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  /** `n` pseudo-random bytes, e.g. the random part of a uuidv7. */
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.uint32() & 0xff;
    return out;
  }
}
