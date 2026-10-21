/** Why an answer was not recorded. Nothing is written when one of these is thrown. */
export type ReviewErrorCode =
  /** The request body is not a valid answer. */
  | "invalid_request"
  /** The presentation token is forged, expired, or was issued to another user. */
  | "invalid_token"
  /** The item does not exist. */
  | "item_not_found"
  /** The user cannot read the item's source. */
  | "forbidden"
  /** The item was retired after it was presented. */
  | "item_retired"
  /** The same item was answered less than 30 seconds ago from another presentation (two tabs). */
  | "duplicate_answer"
  /** Not an option of this item, or the wrong kind of answer for its type. */
  | "invalid_response"
  /** This item type is not graded here yet: cloze in Phase 3, short answers through the worker. */
  | "not_gradable"
  /** The review id already belongs to another user or item. */
  | "review_id_conflict";

/** The HTTP status the answer route returns for each code (05-review-pipeline.md §8.2). */
export const REVIEW_ERROR_STATUS: Record<ReviewErrorCode, number> = {
  invalid_request: 400,
  invalid_token: 400,
  item_not_found: 404,
  forbidden: 403,
  item_retired: 410,
  duplicate_answer: 409,
  invalid_response: 422,
  not_gradable: 422,
  review_id_conflict: 409,
};

export class ReviewError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}
