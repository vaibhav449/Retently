// Golden numbers are pinned to ts-fsrs 5.4.2 with its default parameters (04-scheduler.md §4.2,
// §6.1-6.4). If either changes, these fail on purpose: regenerate deliberately, as a new version.
import { createEmptyCard, fsrs } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { fsrs6V1 } from "./fsrs";
import { DAY_MS } from "./time";
import type { FsrsCardState, Grade } from "./types";

const T0 = new Date("2026-10-01T09:00:00.000Z");
const days = (n: number, from = T0) => new Date(from.getTime() + n * DAY_MS);
const GRADES: Grade[] = [1, 2, 3, 4];

/** A card last reviewed at T0 with the given memory. */
function reviewed(difficulty: number, stability: number): FsrsCardState {
  return {
    ...fsrs6V1.initial(),
    kind: "fsrs",
    last_review_at: T0.toISOString(),
    due_at: days(Math.round(stability)).toISOString(),
    reps: 1,
    difficulty,
    stability,
    scheduled_days: Math.round(stability),
  };
}

const asFsrs = (state: unknown) => state as FsrsCardState;

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

describe("fsrs6-v1 golden numbers", () => {
  it("first review (§4.2)", () => {
    const expected = {
      1: { stability: 0.212, difficulty: 6.413, interval: 1 },
      2: { stability: 1.293, difficulty: 5.112, interval: 2 },
      3: { stability: 2.307, difficulty: 2.118, interval: 3 },
      4: { stability: 8.296, difficulty: 1.0, interval: 8 },
    };
    for (const grade of GRADES) {
      const state = asFsrs(fsrs6V1.next(fsrs6V1.initial(), grade, T0));
      expect(state.stability).toBeCloseTo(expected[grade].stability, 3);
      expect(state.difficulty).toBeCloseTo(expected[grade].difficulty, 3);
      expect(state.scheduled_days).toBe(expected[grade].interval);
      expect(state.due_at).toBe(days(expected[grade].interval).toISOString());
    }
  });

  it("one card's life: Good, Good, Good, Again, Good, each on its due date (§6.1)", () => {
    const life = [
      { grade: 3, rBefore: null, difficulty: 2.118, stability: 2.307, interval: 3 },
      { grade: 3, rBefore: 0.881, difficulty: 2.111, stability: 13.827, interval: 14 },
      { grade: 3, rBefore: 0.899, difficulty: 2.104, stability: 56.957, interval: 57 },
      { grade: 1, rBefore: 0.9, difficulty: 7.39, stability: 3.188, interval: 3 },
      { grade: 3, rBefore: 0.904, difficulty: 7.378, stability: 8.081, interval: 8 },
    ] as const;

    let state = fsrs6V1.initial();
    let now = T0;
    for (const step of life) {
      if (step.rBefore !== null)
        expect(fsrs6V1.retrievability(state, now)).toBeCloseTo(step.rBefore, 3);
      state = fsrs6V1.next(state, step.grade, now);
      expect(asFsrs(state)).toMatchObject({ scheduled_days: step.interval });
      expect(asFsrs(state).difficulty).toBeCloseTo(step.difficulty, 3);
      expect(asFsrs(state).stability).toBeCloseTo(step.stability, 3);
      now = days(step.interval, now);
    }
    expect(state).toMatchObject({ reps: 5, lapses: 1 });
  });

  it("what each grade does to D = 5, S = 10 reviewed on time (§6.2)", () => {
    // Easy's D is 3.31446137 straight from ts-fsrs: §6.2 printed it as 3.315, a rounding slip.
    const expected = {
      1: { difficulty: 8.342, stability: 1.392, interval: 1 },
      2: { difficulty: 6.666, stability: 23.247, interval: 23 },
      3: { difficulty: 4.99, stability: 32.027, interval: 32 },
      4: { difficulty: 3.314, stability: 51.254, interval: 51 },
    };
    for (const grade of GRADES) {
      const state = asFsrs(fsrs6V1.next(reviewed(5, 10), grade, days(10)));
      expect(state.difficulty).toBeCloseTo(expected[grade].difficulty, 3);
      expect(state.stability).toBeCloseTo(expected[grade].stability, 3);
      expect(state.scheduled_days).toBe(expected[grade].interval);
    }
  });

  it("the spacing effect: Good early, on time and late (§6.3)", () => {
    const after = (t: number) => asFsrs(fsrs6V1.next(reviewed(5, 10), 3, days(t))).stability;
    expect(after(3)).toBeCloseTo(18.38, 2);
    expect(after(10)).toBeCloseTo(32.03, 2);
    expect(after(30)).toBeCloseTo(53.56, 2);
  });

  it("a confident wrong answer on a mature card (§6.4)", () => {
    const state = asFsrs(fsrs6V1.next(reviewed(5, 100), 1, days(100)));
    expect(state.difficulty).toBeCloseTo(8.342, 3);
    expect(state.stability).toBeCloseTo(3.747, 3);
    expect(state.scheduled_days).toBe(4);
  });
});

describe("fsrs6-v1 parity with ts-fsrs", () => {
  it("matches the library's long-term scheduler on 500 random 10-review sequences", () => {
    // Reviews land on UTC midnight, where the library's calendar days equal our fractional days.
    const library = fsrs({ enable_short_term: false, enable_fuzz: false, maximum_interval: 365 });
    const next = random(20261022);
    const mismatches: string[] = [];

    for (let sequence = 0; sequence < 500; sequence++) {
      let reviewAt = new Date(Date.UTC(2026, 0, 1 + Math.floor(next() * 300)));
      let card = createEmptyCard(reviewAt);
      let state = fsrs6V1.initial();

      for (let step = 0; step < 10; step++) {
        const grade = (1 + Math.floor(next() * 4)) as Grade;
        card = library.next(card, reviewAt, grade).card;
        const ours = asFsrs((state = fsrs6V1.next(state, grade, reviewAt)));
        if (
          Math.abs(ours.stability - card.stability) > 1e-9 ||
          Math.abs(ours.difficulty - card.difficulty) > 1e-9 ||
          ours.scheduled_days !== card.scheduled_days
        ) {
          mismatches.push(`sequence ${sequence} step ${step}: ${JSON.stringify({ ours, card })}`);
        }
        // Next review early, on time or late: from half the interval before to 1.5x after.
        const offset = Math.round((next() * 2 - 0.5) * card.scheduled_days);
        reviewAt = days(Math.max(0, card.scheduled_days + offset), reviewAt);
      }
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
  });
});

describe("fsrs6-v1 properties (1000 random cases each)", () => {
  const CASES = 1000;
  const TOLERANCE = 1e-7; // ts-fsrs rounds S and D to 8 decimals

  /** A random reviewed card and a random review time t days later. */
  function cases(seed: number): { card: FsrsCardState; t: number; at: Date }[] {
    const next = random(seed);
    return Array.from({ length: CASES }, () => {
      const card = reviewed(1 + next() * 9, 0.1 + next() * 400);
      const t = next() * 3 * card.stability;
      return { card, t, at: days(t) };
    });
  }
  const after = (card: FsrsCardState, grade: Grade, at: Date) =>
    asFsrs(fsrs6V1.next(card, grade, at));

  it("forgetting curve: R(0) = 1, R(S) = 0.9, and R falls over time", () => {
    for (const { card, t } of cases(1)) {
      expect(fsrs6V1.retrievability(card, T0)).toBe(1);
      expect(fsrs6V1.retrievability(card, days(card.stability))).toBeCloseTo(0.9, 6);
      expect(fsrs6V1.retrievability(card, days(t + 0.5))).toBeLessThan(
        fsrs6V1.retrievability(card, days(t)),
      );
    }
  });

  it("success never lowers S; Again never raises it and keeps it at least 0.001", () => {
    for (const { card, at } of cases(2)) {
      for (const grade of [2, 3, 4] as const) {
        expect(after(card, grade, at).stability).toBeGreaterThanOrEqual(
          card.stability * (1 - TOLERANCE),
        );
      }
      const lapse = after(card, 1, at).stability;
      expect(lapse).toBeLessThanOrEqual(card.stability * (1 + TOLERANCE));
      expect(lapse).toBeGreaterThanOrEqual(0.001);
    }
  });

  it("better grades give at least as much stability: Easy ≥ Good ≥ Hard ≥ Again", () => {
    for (const { card, at } of cases(3)) {
      const [again, hard, good, easy] = GRADES.map((grade) => after(card, grade, at).stability);
      expect(easy ?? 0).toBeGreaterThanOrEqual((good ?? 0) * (1 - TOLERANCE));
      expect(good ?? 0).toBeGreaterThanOrEqual((hard ?? 0) * (1 - TOLERANCE));
      expect(hard ?? 0).toBeGreaterThanOrEqual((again ?? 0) * (1 - TOLERANCE));
    }
  });

  it("D stays in [1, 10]; Easy never raises it; Again and Hard barely lower it", () => {
    for (const { card, at } of cases(4)) {
      for (const grade of GRADES) {
        const { difficulty } = after(card, grade, at);
        expect(difficulty).toBeGreaterThanOrEqual(1);
        expect(difficulty).toBeLessThanOrEqual(10);
        if (grade === 4) expect(difficulty).toBeLessThanOrEqual(card.difficulty + TOLERANCE);
        if (grade <= 2) expect(difficulty).toBeGreaterThanOrEqual(card.difficulty - 0.02);
      }
    }
  });

  it("intervals strictly increase with the grade and stay between 1 and 368 days", () => {
    for (const { card, at } of cases(5)) {
      const intervals = GRADES.map((grade) => after(card, grade, at).scheduled_days);
      for (const [i, interval] of intervals.entries()) {
        expect(interval).toBeGreaterThanOrEqual(1);
        expect(interval).toBeLessThanOrEqual(368);
        if (i > 0) expect(interval).toBeGreaterThan(intervals[i - 1] ?? 0);
      }
    }
  });

  it("right after a review R is 1, and a same-moment success leaves S unchanged", () => {
    for (const { card, at } of cases(6)) {
      const state = after(card, 3, at);
      expect(fsrs6V1.retrievability(state, at)).toBe(1);
      const again = after(state, 3, at);
      expect(Math.abs(again.stability - state.stability)).toBeLessThanOrEqual(
        state.stability * TOLERANCE,
      );
    }
  });

  it("reviewing later (and succeeding) never gives less stability than reviewing earlier", () => {
    for (const { card, t } of cases(7)) {
      const early = after(card, 3, days(t)).stability;
      const late = after(card, 3, days(t + 1)).stability;
      expect(late).toBeGreaterThanOrEqual(early * (1 - TOLERANCE));
    }
  });

  it("is deterministic and never mutates its input", () => {
    for (const { card, at } of cases(8).slice(0, 200)) {
      const frozen = Object.freeze({ ...card });
      expect(fsrs6V1.next(frozen, 3, at)).toEqual(fsrs6V1.next(frozen, 3, at));
    }
  });

  it("refuses a state written by another scheduler", () => {
    const placeholder = {
      kind: "placeholder",
      last_review_at: null,
      due_at: null,
      reps: 0,
      lapses: 0,
    } as const;
    expect(() => fsrs6V1.next(placeholder, 3, T0)).toThrow(/"placeholder"/);
  });
});
