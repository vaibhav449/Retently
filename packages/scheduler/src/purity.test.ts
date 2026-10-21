import { describe, expect, it, vi } from "vitest";
import { placeholderV0 } from "./placeholder";
import type { CardState, Grade } from "./types";

/**
 * Runs `fn` with a Date that throws on any clock read (`new Date()`, `Date()`, `Date.now()`) and
 * a Math.random that throws. The swap lasts only for the synchronous call, so Vitest itself never
 * meets the bomb. Dates built from an argument, like `new Date(iso)`, still work.
 *
 * Fake timers would not do: they freeze the clock, so a hidden `Date.now()` would still pass.
 */
function withClockAndRandomBomb<T>(fn: () => T): T {
  const RealDate = Date;
  const BombDate = new Proxy(RealDate, {
    construct(target, args) {
      if (args.length === 0) throw new Error("hidden clock: new Date()");
      return Reflect.construct(target, args) as Date;
    },
    apply() {
      throw new Error("hidden clock: Date()");
    },
    get(target, property, receiver) {
      if (property === "now") {
        return () => {
          throw new Error("hidden clock: Date.now()");
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  const random = vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("hidden randomness: Math.random()");
  });

  globalThis.Date = BombDate;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
    random.mockRestore();
  }
}

const LOG: [string, Grade][] = [
  ["2026-10-01T09:00:00.000Z", 3],
  ["2026-10-02T09:00:00.000Z", 3],
  ["2026-10-05T09:00:00.000Z", 1],
  ["2026-10-05T21:00:00.000Z", 4],
];

/** card_state = fold(next, review_log): start from initial() and apply every review in order. */
function replay(): CardState {
  return LOG.reduce<CardState>(
    (state, [at, grade]) => placeholderV0.next(state, grade, new Date(at)),
    placeholderV0.initial(),
  );
}

describe("purity", () => {
  it("the bomb catches a hidden clock or random call", () => {
    // Deliberately impure functions, to prove the bomb is not a no-op.
    // eslint-disable-next-line no-restricted-syntax -- deliberately reads the clock
    expect(() => withClockAndRandomBomb(() => new Date())).toThrow("hidden clock");
    // eslint-disable-next-line no-restricted-properties -- deliberately reads the clock
    expect(() => withClockAndRandomBomb(() => Date.now())).toThrow("hidden clock");
    // eslint-disable-next-line no-restricted-properties -- deliberately uses randomness
    expect(() => withClockAndRandomBomb(() => Math.random())).toThrow("hidden randomness");
  });

  it("replays a review log without the clock or randomness, with the same result every time", () => {
    const first = withClockAndRandomBomb(replay);
    const second = withClockAndRandomBomb(replay);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ last_review_at: "2026-10-05T21:00:00.000Z", reps: 4, lapses: 1 });
  });

  it("reads retrievability and stability without the clock", () => {
    const state = replay();
    const at = new Date("2026-10-07T09:00:00.000Z"); // 1.5 days after the last review
    expect(withClockAndRandomBomb(() => placeholderV0.retrievability(state, at))).toBeCloseTo(
      0.9 ** 1.5,
      10,
    );
    expect(withClockAndRandomBomb(() => placeholderV0.stabilityDays(state))).toBe(1);
  });

  it("never mutates the state it is given", () => {
    const frozen = Object.freeze(
      placeholderV0.next(placeholderV0.initial(), 3, new Date("2026-10-01T09:00:00.000Z")),
    );
    const next = placeholderV0.next(frozen, 1, new Date("2026-10-02T09:00:00.000Z"));
    expect(next).not.toBe(frozen);
    expect(frozen).toMatchObject({ reps: 1, lapses: 0 });
    expect(next).toMatchObject({ reps: 2, lapses: 1 });
  });

  it("hands out a fresh initial state each time, so callers cannot share one", () => {
    expect(placeholderV0.initial()).not.toBe(placeholderV0.initial());
  });
});
