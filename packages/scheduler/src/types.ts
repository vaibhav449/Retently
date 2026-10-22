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

export interface FsrsCardState extends CardState {
  kind: "fsrs";
  /** D, from 1 (easy) to 10 (hard) for this student; 0 until the first review. */
  difficulty: number;
  /** S, in days: how long recall takes to fall from 1 to 0.9; 0 until the first review. */
  stability: number;
  /** The interval chosen at the last review, in days. */
  scheduled_days: number;
}

export interface Sm2CardState extends CardState {
  kind: "sm2";
  /** SM-2's n: successful reviews in a row, back to 0 after a miss. `reps` counts all reviews. */
  repetition: number;
  /** Days until the next review; 0 until the first review. */
  interval: number;
  /** The easiness factor, from 2.5, never below 1.3. */
  ease: number;
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
