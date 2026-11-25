import { DAY_MS } from "@repo/scheduler";
import { describe, expect, it } from "vitest";
import { answerItem, confidenceOf, type ItemMind } from "./answer";
import { DEFAULT_SYNTH } from "./config";
import { Rng } from "./rng";
import { drawStudent, type Student } from "./student";
import { memoryFactory, perturbedParameters, type TrueMemory } from "./truth";

const T0 = new Date("2026-11-01T03:00:00.000Z");
const days = (n: number) => new Date(T0.getTime() + n * DAY_MS);
const cfg = DEFAULT_SYNTH;

function memory(family: "fsrsPerturbed" | "expHalfLife", ability = 1): TrueMemory {
  const w = perturbedParameters(new Rng("w"), cfg);
  return memoryFactory({ family, w, ability }, cfg)(0);
}

describe.each(["fsrsPerturbed", "expHalfLife"] as const)("the %s truth", (family) => {
  it("knows nothing before the study event, everything right after, and forgets", () => {
    const m = memory(family);
    expect(m.recall(T0)).toBe(0);
    m.start(T0, 3);
    expect(m.recall(T0)).toBeCloseTo(1, 6);
    const r1 = m.recall(days(1));
    const r5 = m.recall(days(5));
    expect(r1).toBeLessThan(1);
    expect(r5).toBeLessThan(r1);
    expect(r5).toBeGreaterThan(0);
  });

  it("forgets more slowly after a success than after a failure", () => {
    const success = memory(family);
    const failure = memory(family);
    for (const m of [success, failure]) m.start(T0, 3);
    success.review(days(3), true);
    failure.review(days(3), false);
    expect(success.recall(days(10))).toBeGreaterThan(failure.recall(days(10)));
  });

  it("grows faster for a more able student", () => {
    const able = memory(family, 1.5);
    const slow = memory(family, 0.6);
    for (const m of [able, slow]) {
      m.start(T0, 3);
      m.review(days(3), true);
    }
    expect(able.recall(days(15))).toBeGreaterThan(slow.recall(days(15)));
  });
});

describe("expHalfLife", () => {
  it("is at 0.5 after one half-life", () => {
    const m = memoryFactory({ family: "expHalfLife", w: [], ability: 1 }, cfg)(0);
    m.start(T0, 3);
    expect(m.recall(days(cfg.halfLifeTruth.initialDays))).toBeCloseTo(0.5, 6);
  });
});

/** A student with a fixed bias and speed 1, for the answer model. */
function withBias(bias: number): Student {
  return { ...drawStudent("answer", 1, cfg), bias, speed: 1 };
}

/** A memory whose recall is always `r`, so answers can be counted against a known truth. */
function fixedRecall(r: number): TrueMemory {
  return { recall: () => r, start: () => {}, review: () => {} };
}

function answers(student: Student, r: number, n: number, misconceived = false) {
  const rng = new Rng("answers", student.bias, r, misconceived ? 1 : 0);
  return Array.from({ length: n }, () => {
    const mind: ItemMind = {
      memory: fixedRecall(r),
      misconceived,
      exposures: misconceived ? 1 : 3,
    };
    return answerItem(mind, T0, "mcq", 3, student, rng, cfg);
  });
}

const share = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length / xs.length;

describe("the answer model", () => {
  it("is correct with probability R + (1 − R) · 0.25 for an MCQ", () => {
    expect(share(answers(withBias(0), 0, 4_000), (a) => a.correct)).toBeCloseTo(0.25, 1);
    expect(share(answers(withBias(0), 0.6, 4_000), (a) => a.correct)).toBeCloseTo(0.7, 1);
  });

  it("says Sure more often for an over-confident student than an under-confident one", () => {
    const over = share(answers(withBias(1), 0.8, 3_000), (a) => a.confidence === "sure");
    const under = share(answers(withBias(-0.4), 0.8, 3_000), (a) => a.confidence === "sure");
    expect(over).toBeGreaterThan(under + 0.15);
  });

  it("is almost always wrong and usually Sure while misconceived", () => {
    const drawn = answers(withBias(0.4), 0.9, 2_000, true);
    expect(share(drawn, (a) => a.correct)).toBeLessThan(0.1);
    expect(share(drawn, (a) => a.confidence === "sure")).toBeGreaterThan(0.8);
    expect(share(drawn, (a) => !a.correct && a.wrongIndex === 0)).toBeGreaterThan(0.9);
  });

  it("is slower when recall is weaker, and stays inside the latency clamp", () => {
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
    const strong = answers(withBias(0), 0.95, 2_000).map((a) => a.latencyMs);
    const weak = answers(withBias(0), 0.2, 2_000).map((a) => a.latencyMs);
    expect(median(weak)).toBeGreaterThan(median(strong));
    for (const ms of [...strong, ...weak]) {
      expect(ms).toBeGreaterThanOrEqual(cfg.latency.clampMs[0]);
      expect(ms).toBeLessThanOrEqual(cfg.latency.clampMs[1]);
      expect(Number.isInteger(ms)).toBe(true);
    }
  });

  it("cuts the latent score at the spec's thresholds", () => {
    const { sureAbove, thinkSoAbove } = cfg.confidence;
    expect(confidenceOf(sureAbove + 0.01, cfg)).toBe("sure");
    expect(confidenceOf(sureAbove, cfg)).toBe("think_so");
    expect(confidenceOf(thinkSoAbove + 0.01, cfg)).toBe("think_so");
    expect(confidenceOf(thinkSoAbove, cfg)).toBe("no_idea");
  });

  it("restarts the memory when a misconception is corrected", () => {
    const starts: number[] = [];
    const mind: ItemMind = {
      memory: { recall: () => 0.9, start: (_at, grade) => starts.push(grade), review: () => {} },
      misconceived: true,
      exposures: 1,
    };
    const rng = new Rng("restart");
    for (let i = 0; i < 20 && mind.misconceived; i++) {
      answerItem(mind, T0, "mcq", 3, withBias(0), rng, cfg);
    }
    expect(mind.misconceived).toBe(false);
    expect(starts).toEqual([2]);
  });
});
