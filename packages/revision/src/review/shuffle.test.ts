import { describe, expect, it } from "vitest";
import { shuffleBySeed } from "./shuffle";

const OPTIONS = ["Ribosome", "Mitochondrion", "Golgi apparatus", "Lysosome"] as const;

describe("shuffleBySeed", () => {
  it("gives the same order for the same seed", () => {
    const seed = "0192f0c4-7d2a-7c3e-9a51-4b8f0e6d1a23";
    expect(shuffleBySeed(OPTIONS, seed)).toEqual(shuffleBySeed(OPTIONS, seed));
  });

  it("keeps every item exactly once and leaves the input alone", () => {
    const input = [...OPTIONS];
    const shuffled = shuffleBySeed(input, "seed");
    expect([...shuffled].sort()).toEqual([...OPTIONS].sort());
    expect(input).toEqual([...OPTIONS]);
  });

  it("puts the answer in every position across presentations", () => {
    const positions = new Set(
      Array.from({ length: 200 }, (_, i) =>
        shuffleBySeed(OPTIONS, `review-${i}`).indexOf("Mitochondrion"),
      ),
    );
    expect([...positions].sort()).toEqual([0, 1, 2, 3]);
  });
});
