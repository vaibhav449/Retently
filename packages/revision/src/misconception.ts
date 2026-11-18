import type { Confidence, ReviewContext } from "@repo/contracts";
import { startOfNextLocalDay } from "./time";

/** The three facts of a review that decide whether it is a misconception (05 §6.1). */
export interface ReviewFacts {
  context: ReviewContext;
  confidence: Confidence | null;
  correct: boolean;
}

/**
 * solo ∧ Sure ∧ wrong: the only definition of a misconception (05-review-pipeline.md §6.1, D-13).
 * A duel answer never is one: it has no confidence.
 */
export function isMisconception(review: ReviewFacts): boolean {
  return review.context === "solo" && review.confidence === "sure" && !review.correct;
}

/**
 * card_state.misconception_until after this review (05 §6.2, invariant I4): the start of the next
 * local day for a misconception, else null. A pure function of the latest review, so
 * recordReview(), rebuild and check all derive it the same way. `timeZone` must be resolved.
 */
export function misconceptionUntilAfter(
  review: ReviewFacts & { reviewedAt: Date },
  timeZone: string,
): Date | null {
  return isMisconception(review) ? startOfNextLocalDay(review.reviewedAt, timeZone) : null;
}

/**
 * The earlier of due_at and misconception_until (05 §6.2). The override only pulls a card
 * earlier, never later, and never changes due_at itself (I3).
 */
export function effectiveDueAt(card: { dueAt: Date; misconceptionUntil: Date | null }): Date {
  const { dueAt, misconceptionUntil } = card;
  return misconceptionUntil !== null && misconceptionUntil.getTime() < dueAt.getTime()
    ? misconceptionUntil
    : dueAt;
}
