import type { Confidence, ReviewContext } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_GRADING } from "./config";
import { mapGrade } from "./grading/mapping";
import { effectiveDueAt, isMisconception, misconceptionUntilAfter } from "./misconception";

const contexts: ReviewContext[] = ["solo", "duel"];
const confidences: (Confidence | null)[] = ["sure", "think_so", "no_idea", null];

/** Every (context, confidence, correct) combination. */
function* allFacts() {
  for (const context of contexts) {
    for (const confidence of confidences) {
      for (const correct of [true, false]) yield { context, confidence, correct };
    }
  }
}

// 21:00 IST on 18 Nov 2026; the next IST midnight is 18:30 UTC the same day.
const NINE_PM_IST = new Date("2026-11-18T15:30:00.000Z");
const NEXT_IST_MIDNIGHT = new Date("2026-11-18T18:30:00.000Z");

describe("isMisconception (05 §6.1)", () => {
  it("is true only for solo · Sure · wrong", () => {
    for (const facts of allFacts()) {
      const expected = facts.context === "solo" && facts.confidence === "sure" && !facts.correct;
      expect(isMisconception(facts), JSON.stringify(facts)).toBe(expected);
    }
  });

  it("never holds for a duel, even one that carries a confidence", () => {
    expect(isMisconception({ context: "duel", confidence: "sure", correct: false })).toBe(false);
  });

  it("agrees with mapGrade for every signal combination", () => {
    for (const facts of allFacts()) {
      for (const medianMs of [null, 10_000]) {
        const signals = { ...facts, latencyMs: 5_000, medianMs };
        expect(mapGrade(signals, DEFAULT_GRADING).misconception, JSON.stringify(facts)).toBe(
          isMisconception(facts),
        );
      }
    }
  });
});

describe("misconceptionUntilAfter (05 §6.2, I4)", () => {
  it("is the next local midnight after a 21:00 IST Sure + wrong", () => {
    const review = {
      context: "solo",
      confidence: "sure",
      correct: false,
      reviewedAt: NINE_PM_IST,
    } as const;
    expect(misconceptionUntilAfter(review, "Asia/Kolkata")).toEqual(NEXT_IST_MIDNIGHT);
  });

  it("is null for every review that is not a misconception", () => {
    for (const facts of allFacts()) {
      if (isMisconception(facts)) continue;
      expect(misconceptionUntilAfter({ ...facts, reviewedAt: NINE_PM_IST }, "Asia/Kolkata")).toBe(
        null,
      );
    }
  });
});

describe("effectiveDueAt (05 §6.2)", () => {
  const dueAt = new Date("2026-11-22T15:30:00.000Z");

  it("is due_at without an override", () => {
    expect(effectiveDueAt({ dueAt, misconceptionUntil: null })).toEqual(dueAt);
  });

  it("is the override when it comes first", () => {
    expect(effectiveDueAt({ dueAt, misconceptionUntil: NEXT_IST_MIDNIGHT })).toEqual(
      NEXT_IST_MIDNIGHT,
    );
  });

  it("is due_at when the override comes later (a 25-hour day)", () => {
    const later = new Date(dueAt.getTime() + 60 * 60 * 1000);
    expect(effectiveDueAt({ dueAt, misconceptionUntil: later })).toEqual(dueAt);
  });
});
