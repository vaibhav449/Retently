import { addDays, daysBetween } from "./time";
import type { CardState, Grade, PlaceholderCardState, Scheduler } from "./types";

/** R one day after a review. With a one-day interval, every item is due when R reaches 0.9. */
const DAILY_RECALL = 0.9;

/**
 * placeholder-v0 (04-scheduler.md §8): every item is due one day after its review, whatever the
 * grade, and R = 0.9^t. A stand-in until FSRS. review_log keeps the real grades, so card_state
 * can be rebuilt with FSRS later without losing anything.
 */
export const placeholderV0: Scheduler = {
  version: "placeholder-v0",

  initial(): PlaceholderCardState {
    return { kind: "placeholder", last_review_at: null, due_at: null, reps: 0, lapses: 0 };
  },

  next(state: CardState, grade: Grade, now: Date): PlaceholderCardState {
    assertPlaceholder(state);
    // A first-review Again is not a lapse: nothing had been learned yet.
    const lapsed = grade === 1 && state.last_review_at !== null;
    return {
      kind: "placeholder",
      last_review_at: now.toISOString(),
      due_at: addDays(now, 1).toISOString(),
      reps: state.reps + 1,
      lapses: state.lapses + (lapsed ? 1 : 0),
    };
  },

  retrievability(state: CardState, at: Date): number {
    assertPlaceholder(state);
    if (state.last_review_at === null) return 0;
    const elapsedDays = Math.max(0, daysBetween(at, new Date(state.last_review_at)));
    return DAILY_RECALL ** elapsedDays;
  },

  stabilityDays(state: CardState): number {
    assertPlaceholder(state);
    return state.last_review_at === null ? 0 : 1;
  },
};

// A state is advanced only by the scheduler that wrote it (03-data-model.md §5).
function assertPlaceholder(state: CardState): asserts state is PlaceholderCardState {
  if (state.kind !== "placeholder") {
    throw new Error(
      `placeholder-v0 got a "${state.kind}" card state; use the scheduler that wrote it`,
    );
  }
}
