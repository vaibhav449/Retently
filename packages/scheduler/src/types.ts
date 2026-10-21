/** 1 Again · 2 Hard · 3 Good · 4 Easy. packages/revision turns an answer's signals into one. */
export type Grade = 1 | 2 | 3 | 4;

/**
 * One student's memory of one item. Stored as `card_state.state` (jsonb), so it must survive
 * JSON: dates are ISO-8601 UTC strings. `kind` tells scheduler families apart.
 */
export interface CardState {
  kind: "fsrs" | "sm2" | "placeholder";
  /** Null until the first review. */
  last_review_at: string | null;
  /** Null until the first review. */
  due_at: string | null;
  /** Reviews applied so far. */
  reps: number;
  /** Again grades after the first review: forgetting something already learned. */
  lapses: number;
}

export interface PlaceholderCardState extends CardState {
  kind: "placeholder";
}

/**
 * A pure scheduler (04-scheduler.md §2): no clock, no randomness, no I/O. Time always comes in
 * as an argument, so the same inputs give the same output and card_state can be rebuilt by
 * replaying review_log.
 */
export interface Scheduler {
  /** Written into every review_log and card_state row, e.g. "placeholder-v0". */
  readonly version: string;
  /** The state of an item that has never been reviewed. */
  initial(): CardState;
  /** The state after a review with `grade` at `now`. Never mutates `state`. */
  next(state: CardState, grade: Grade, now: Date): CardState;
  /** Probability of recall at `at`, from 0 to 1; 0 for an item that has never been reviewed. */
  retrievability(state: CardState, at: Date): number;
  /** Stability (or interval) in days. The queue ranker uses it without knowing the family. */
  stabilityDays(state: CardState): number;
}
