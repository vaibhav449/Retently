import type { Confidence, ReviewContext } from "@repo/contracts";
import type { Grade } from "@repo/scheduler";
import { describe, expect, it } from "vitest";
import { mapGrade, type Signals, speedMatters } from "./mapping";

const CONFIG = { fastRatio: 1 };
const MEDIAN_MS = 10_000;
const FAST_MS = 6_000;
const SLOW_MS = 14_000;

const solo = (signals: Pick<Signals, "confidence" | "correct" | "latencyMs">): Signals => ({
  context: "solo",
  medianMs: MEDIAN_MS,
  ...signals,
});

const duel = (correct: boolean): Signals => ({
  context: "duel",
  confidence: null,
  correct,
  latencyMs: FAST_MS,
  medianMs: null,
});

// One case per row of 05-review-pipeline.md §5.1.
const TABLE: { row: string; signals: Signals; grade: Grade; misconception: boolean }[] = [
  {
    row: "solo · Sure · correct · fast → Easy",
    signals: solo({ confidence: "sure", correct: true, latencyMs: FAST_MS }),
    grade: 4,
    misconception: false,
  },
  {
    row: "solo · Sure · correct · slow → Good",
    signals: solo({ confidence: "sure", correct: true, latencyMs: SLOW_MS }),
    grade: 3,
    misconception: false,
  },
  {
    row: "solo · Think so · correct → Hard (speed does not matter)",
    signals: solo({ confidence: "think_so", correct: true, latencyMs: FAST_MS }),
    grade: 2,
    misconception: false,
  },
  {
    row: "solo · No idea · correct → Hard (never reward a guess)",
    signals: solo({ confidence: "no_idea", correct: true, latencyMs: FAST_MS }),
    grade: 2,
    misconception: false,
  },
  {
    row: "solo · Think so · wrong → Again",
    signals: solo({ confidence: "think_so", correct: false, latencyMs: FAST_MS }),
    grade: 1,
    misconception: false,
  },
  {
    row: "solo · No idea · wrong → Again",
    signals: solo({ confidence: "no_idea", correct: false, latencyMs: FAST_MS }),
    grade: 1,
    misconception: false,
  },
  {
    row: "solo · Sure · wrong → Again, misconception",
    signals: solo({ confidence: "sure", correct: false, latencyMs: FAST_MS }),
    grade: 1,
    misconception: true,
  },
  { row: "duel · correct → Hard", signals: duel(true), grade: 2, misconception: false },
  { row: "duel · wrong → Again", signals: duel(false), grade: 1, misconception: false },
];

describe("mapGrade (spec-v1)", () => {
  it.each(TABLE)("$row", ({ signals, grade, misconception }) => {
    expect(mapGrade(signals, CONFIG)).toEqual({ grade, misconception });
  });

  it("counts a latency exactly equal to the median as fast", () => {
    const signals = solo({ confidence: "sure", correct: true, latencyMs: MEDIAN_MS });
    expect(mapGrade(signals, CONFIG).grade).toBe(4);
  });

  it("gives Good, never Easy, without a median yet (cold start)", () => {
    const signals = {
      ...solo({ confidence: "sure", correct: true, latencyMs: 1 }),
      medianMs: null,
    };
    expect(mapGrade(signals, CONFIG).grade).toBe(3);
  });

  it("gives Good when the latency is missing", () => {
    const signals = solo({ confidence: "sure", correct: true, latencyMs: null });
    expect(mapGrade(signals, CONFIG).grade).toBe(3);
  });

  it("uses fastRatio from the config", () => {
    const signals = solo({ confidence: "sure", correct: true, latencyMs: 9_000 });
    expect(mapGrade(signals, { fastRatio: 1 }).grade).toBe(4);
    expect(mapGrade(signals, { fastRatio: 0.8 }).grade).toBe(3);
  });
});

// AC1 (R1.3, R1.4): the three outcomes of a confident correct answer, against a 10 s median.
describe("mapGrade: latency-relative grading of Sure + correct", () => {
  const sureCorrect = (latencyMs: number, medianMs: number | null): Signals => ({
    context: "solo",
    confidence: "sure",
    correct: true,
    latencyMs,
    medianMs,
  });

  it("is Easy when at least as fast as the median", () => {
    expect(mapGrade(sureCorrect(9_000, 10_000), CONFIG).grade).toBe(4);
  });

  it("is Good when slower than the median", () => {
    expect(mapGrade(sureCorrect(11_000, 10_000), CONFIG).grade).toBe(3);
  });

  it("is Good without a valid median, however fast", () => {
    expect(mapGrade(sureCorrect(0, null), CONFIG).grade).toBe(3);
  });
});

// DD-6: recordReview() reads the median only where speedMatters(), so it must not matter elsewhere.
describe("speedMatters", () => {
  const contexts: ReviewContext[] = ["solo", "duel"];
  const confidences: (Confidence | null)[] = ["sure", "think_so", "no_idea", null];
  const medians = [null, 1, 10_000, 1e9];
  const latencies = [null, 0, 5_000, 20_000];

  it("is true only for solo · Sure · correct", () => {
    for (const context of contexts) {
      for (const confidence of confidences) {
        for (const correct of [true, false]) {
          const expected = context === "solo" && confidence === "sure" && correct;
          expect(speedMatters({ context, confidence, correct }), `${context} ${confidence}`).toBe(
            expected,
          );
        }
      }
    }
  });

  it("marks every combination where median or latency can change the grade", () => {
    for (const context of contexts) {
      for (const confidence of confidences) {
        for (const correct of [true, false]) {
          if (speedMatters({ context, confidence, correct })) continue;
          const results = new Set<string>();
          for (const medianMs of medians) {
            for (const latencyMs of latencies) {
              const result = mapGrade(
                { context, confidence, correct, latencyMs, medianMs },
                CONFIG,
              );
              results.add(JSON.stringify(result));
            }
          }
          expect(results.size, `${context} · ${confidence} · ${correct}`).toBe(1);
        }
      }
    }
  });
});
