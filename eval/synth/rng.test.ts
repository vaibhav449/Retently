import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

const draws = (rng: Rng, n: number, f: (r: Rng) => number) =>
  Array.from({ length: n }, () => f(rng));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("Rng", () => {
  it("gives the same stream for the same labels and a different one otherwise", () => {
    const a = draws(new Rng("s", 1), 20, (r) => r.uint32());
    expect(draws(new Rng("s", 1), 20, (r) => r.uint32())).toEqual(a);
    expect(draws(new Rng("s", 2), 20, (r) => r.uint32())).not.toEqual(a);
  });

  it("draws uniforms in [0, 1) and integers in the closed range", () => {
    const rng = new Rng("uniform");
    const us = draws(rng, 5_000, (r) => r.next());
    expect(Math.min(...us)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...us)).toBeLessThan(1);
    expect(mean(us)).toBeCloseTo(0.5, 1);
    const ints = new Set(draws(rng, 2_000, (r) => r.int(3, 6)));
    expect([...ints].sort()).toEqual([3, 4, 5, 6]);
  });

  it("draws normals and betas with the right moments", () => {
    const rng = new Rng("moments");
    const zs = draws(rng, 20_000, (r) => r.normal(2, 0.5));
    expect(mean(zs)).toBeCloseTo(2, 1);
    const sd = Math.sqrt(mean(zs.map((z) => (z - 2) ** 2)));
    expect(sd).toBeCloseTo(0.5, 1);
    // Beta(6, 2) has mean 0.75 (09 §5.2 adherence).
    expect(mean(draws(rng, 20_000, (r) => r.beta(6, 2)))).toBeCloseTo(0.75, 1);
  });

  it("shuffles without losing or adding elements", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = new Rng("shuffle").shuffle(items);
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
