import type { CardState, Grade, Scheduler } from "./types";

/** One logged answer, as replay needs it: the grade that was recorded, and when. */
export interface LoggedReview {
  grade: Grade;
  reviewedAt: Date;
}

/**
 * fold(next, log): the card's state after every review in `reviews`, in the order given, starting
 * from `initial()`. card_state is a cache of this (03-data-model.md §6), so rebuilding it, checking
 * it and evaluating another scheduler all replay the log through here. Callers sort the log by
 * (reviewed_at, id) first; the scheduler itself clamps negative gaps to zero.
 */
export function replay(scheduler: Scheduler, reviews: readonly LoggedReview[]): CardState {
  return reviews.reduce(
    (state, review) => scheduler.next(state, review.grade, review.reviewedAt),
    scheduler.initial(),
  );
}
