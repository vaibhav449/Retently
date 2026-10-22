import { describe, expect, it } from "vitest";
import { sm2V1 } from "./sm2";
import { DAY_MS } from "./time";
import type { CardState, Grade, Sm2CardState } from "./types";

const T0 = new Date("2026-10-01T09:00:00.000Z");
const days = (n: number, from = T0) => new Date(from.getTime() + n * DAY_MS);
const asSm2 = (state: CardState) => state as Sm2CardState;

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

describe("sm2-v1", () => {
  it("follows the spec's example: Good, Good, Good, Again, Good (§7.3)", () => {
    const expected = [
      { grade: 3, repetition: 1, interval: 1, ease: 2.5 },
      { grade: 3, repetition: 2, interval: 6, ease: 2.5 },
      { grade: 3, repetition: 3, interval: 15, ease: 2.5 },
      { grade: 1, repetition: 0, interval: 1, ease: 2.5 },
      { grade: 3, repetition: 1, interval: 1, ease: 2.5 },
    ] as const;

    let state = sm2V1.initial();
    let now = T0;
    for (const step of expected) {
      state = sm2V1.next(state, step.grade, now);
      expect(asSm2(state)).toMatchObject({
        repetition: step.repetition,
        interval: step.interval,
        due_at: days(step.interval, now).toISOString(),
      });
      expect(asSm2(state).ease).toBeCloseTo(step.ease, 10);
      now = days(step.interval, now);
    }
    // `reps` counts every review; SM-2's own counter is `repetition`.
    expect(state).toMatchObject({ reps: 5, lapses: 1 });
  });

  it("moves ease by grade: Hard −0.14, Good 0, Easy +0.10", () => {
    const easeAfter = (grade: Grade) => asSm2(sm2V1.next(sm2V1.initial(), grade, T0)).ease;
    expect(easeAfter(2)).toBeCloseTo(2.36, 10);
    expect(easeAfter(3)).toBeCloseTo(2.5, 10);
    expect(easeAfter(4)).toBeCloseTo(2.6, 10);
    expect(easeAfter(1)).toBe(2.5); // a miss leaves ease alone
  });

  it("caps intervals at 365 days, even after a long run of Easy answers", () => {
    let state = sm2V1.initial();
    let now = T0;
    for (let i = 0; i < 40; i++) {
      state = sm2V1.next(state, 4, now);
      now = days(asSm2(state).interval, now);
    }
    expect(asSm2(state).interval).toBe(365);
  });

  it("never lets ease fall below 1.3, and a miss always restarts at 1 day", () => {
    const next = random(42);
    let state = sm2V1.initial();
    let now = T0;
    for (let i = 0; i < 1000; i++) {
      const grade = (1 + Math.floor(next() * 4)) as Grade;
      state = sm2V1.next(state, grade, now);
      const card = asSm2(state);
      expect(card.ease).toBeGreaterThanOrEqual(1.3);
      if (grade === 1) expect(card).toMatchObject({ repetition: 0, interval: 1 });
      now = days(card.interval, now);
    }
  });

  it("uses 0.9^(t / interval) as R: 1 just after a review, 0.9 at the due date", () => {
    const state = sm2V1.next(sm2V1.next(sm2V1.initial(), 3, T0), 3, days(1));
    expect(sm2V1.retrievability(sm2V1.initial(), T0)).toBe(0);
    expect(sm2V1.retrievability(state, days(1))).toBe(1);
    expect(sm2V1.retrievability(state, days(7))).toBeCloseTo(0.9, 10);
    expect(sm2V1.stabilityDays(state)).toBe(6);
  });

  it("is deterministic, never mutates its input, and refuses another scheduler's state", () => {
    const frozen = Object.freeze(sm2V1.next(sm2V1.initial(), 3, T0));
    expect(sm2V1.next(frozen, 4, days(1))).toEqual(sm2V1.next(frozen, 4, days(1)));
    const placeholder = {
      kind: "placeholder",
      last_review_at: null,
      due_at: null,
      reps: 0,
      lapses: 0,
    } as const;
    expect(() => sm2V1.next(placeholder, 3, T0)).toThrow(/"placeholder"/);
  });
});
