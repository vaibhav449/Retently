import type { Grade } from "@repo/scheduler";
import { describe, expect, it } from "vitest";
import { mapGrade, type Signals } from "./mapping";

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
