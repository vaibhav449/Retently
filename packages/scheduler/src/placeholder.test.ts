import { describe, expect, it } from "vitest";
import { placeholderV0 } from "./placeholder";
import type { CardState, Grade } from "./types";

const FIRST_REVIEW = new Date("2026-10-01T09:00:00.000Z");

describe("placeholder-v0", () => {
  it("starts with a card that has never been reviewed", () => {
    const state = placeholderV0.initial();
    expect(state).toEqual({
      kind: "placeholder",
      last_review_at: null,
      due_at: null,
      reps: 0,
      lapses: 0,
    });
    expect(placeholderV0.retrievability(state, FIRST_REVIEW)).toBe(0);
    expect(placeholderV0.stabilityDays(state)).toBe(0);
  });

  it("follows one card through four reviews", () => {
    // Good, Good on time, Again three days late, Easy twelve hours later.
    const life: { at: string; grade: Grade; rBefore: number; due: string; lapses: number }[] = [
      {
        at: "2026-10-01T09:00:00.000Z",
        grade: 3,
        rBefore: 0,
        due: "2026-10-02T09:00:00.000Z",
        lapses: 0,
      },
      {
        at: "2026-10-02T09:00:00.000Z",
        grade: 3,
        rBefore: 0.9,
        due: "2026-10-03T09:00:00.000Z",
        lapses: 0,
      },
      {
        at: "2026-10-05T09:00:00.000Z",
        grade: 1,
        rBefore: 0.729,
        due: "2026-10-06T09:00:00.000Z",
        lapses: 1,
      },
      {
        at: "2026-10-05T21:00:00.000Z",
        grade: 4,
        rBefore: 0.9 ** 0.5,
        due: "2026-10-06T21:00:00.000Z",
        lapses: 1,
      },
    ];

    let state: CardState = placeholderV0.initial();
    life.forEach((step, index) => {
      const now = new Date(step.at);
      expect(placeholderV0.retrievability(state, now)).toBeCloseTo(step.rBefore, 10);
      state = placeholderV0.next(state, step.grade, now);
      expect(state).toEqual({
        kind: "placeholder",
        last_review_at: step.at,
        due_at: step.due,
        reps: index + 1,
        lapses: step.lapses,
      });
    });
  });

  it("does not count an Again on the first review as a lapse", () => {
    const state = placeholderV0.next(placeholderV0.initial(), 1, FIRST_REVIEW);
    expect(state).toMatchObject({ reps: 1, lapses: 0 });
  });

  it("treats a time before the last review as zero days, so R is 1", () => {
    const state = placeholderV0.next(placeholderV0.initial(), 3, FIRST_REVIEW);
    expect(placeholderV0.retrievability(state, new Date("2026-09-30T09:00:00.000Z"))).toBe(1);
  });

  it("has a stability of one day once reviewed", () => {
    const state = placeholderV0.next(placeholderV0.initial(), 3, FIRST_REVIEW);
    expect(placeholderV0.stabilityDays(state)).toBe(1);
  });

  it("produces states that survive JSON, because card_state.state is jsonb", () => {
    const state = placeholderV0.next(placeholderV0.initial(), 3, FIRST_REVIEW);
    const roundTripped: unknown = JSON.parse(JSON.stringify(state));
    expect(roundTripped).toEqual(state);
  });

  it("refuses a state written by another scheduler", () => {
    const fsrsState: CardState = {
      kind: "fsrs",
      last_review_at: null,
      due_at: null,
      reps: 0,
      lapses: 0,
    };
    expect(() => placeholderV0.next(fsrsState, 3, FIRST_REVIEW)).toThrow(/"fsrs"/);
    expect(() => placeholderV0.retrievability(fsrsState, FIRST_REVIEW)).toThrow(/"fsrs"/);
    expect(() => placeholderV0.stabilityDays(fsrsState)).toThrow(/"fsrs"/);
  });
});
