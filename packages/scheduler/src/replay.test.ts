import { describe, expect, it } from "vitest";
import { fsrs6V1 } from "./fsrs";
import { placeholderV0 } from "./placeholder";
import { type LoggedReview, replay } from "./replay";
import { sm2V1 } from "./sm2";
import { DAY_MS } from "./time";
import type { CardState, Grade } from "./types";

const T0 = new Date("2026-10-01T09:00:00.000Z");
const SCHEDULERS = [placeholderV0, fsrs6V1, sm2V1];

/** Seeded and deterministic (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random history: 1 to 12 answers, each up to 40 days after the one before. */
function history(next: () => number): LoggedReview[] {
  const reviews: LoggedReview[] = [];
  let at = T0.getTime();
  const count = 1 + Math.floor(next() * 12);
  for (let i = 0; i < count; i++) {
    at += Math.floor(next() * 40 * DAY_MS);
    reviews.push({ grade: (1 + Math.floor(next() * 4)) as Grade, reviewedAt: new Date(at) });
  }
  return reviews;
}

describe("replay", () => {
  it("gives the initial state for an empty log", () => {
    for (const scheduler of SCHEDULERS) {
      expect(replay(scheduler, [])).toEqual(scheduler.initial());
    }
  });

  it("equals calling next() answer by answer, for every scheduler (200 seeded histories)", () => {
    const next = random(2026);
    for (let i = 0; i < 200; i++) {
      const reviews = history(next);
      for (const scheduler of SCHEDULERS) {
        let state: CardState = scheduler.initial();
        for (const review of reviews)
          state = scheduler.next(state, review.grade, review.reviewedAt);
        expect(replay(scheduler, reviews)).toEqual(state);
      }
    }
  });

  it("depends on the order of the log", () => {
    const reviews: LoggedReview[] = [
      { grade: 3, reviewedAt: T0 },
      { grade: 1, reviewedAt: new Date(T0.getTime() + 3 * DAY_MS) },
    ];
    expect(replay(fsrs6V1, reviews)).not.toEqual(replay(fsrs6V1, [...reviews].reverse()));
  });

  it("does not change the log it is given", () => {
    const reviews = Object.freeze([Object.freeze({ grade: 3 as const, reviewedAt: T0 })]);
    expect(() => replay(fsrs6V1, reviews)).not.toThrow();
    expect(reviews).toEqual([{ grade: 3, reviewedAt: T0 }]);
  });
});
