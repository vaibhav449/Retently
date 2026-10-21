import { type ItemType, mcqOptionSchema, type ReviewResponse } from "@repo/contracts";
import { ReviewError } from "../errors";

/** What grading needs from an items row. */
export interface GradableItem {
  type: ItemType;
  /** jsonb: [{ id, text }] for an MCQ, [] otherwise. */
  options: unknown;
  answerOptionId: string | null;
}

const mcqOptionsSchema = mcqOptionSchema.array();

/**
 * Whether the answer is correct, graded on the server and never self-reported.
 * Phase 1 grades MCQs only, by option id.
 */
export function gradeLocally(item: GradableItem, response: ReviewResponse): boolean {
  if (item.type !== "mcq") {
    throw new ReviewError("not_gradable", `${item.type} answers are not graded here yet`);
  }
  if (response.kind !== "mcq") {
    throw new ReviewError("invalid_response", "an MCQ answer must name an option id");
  }
  const options = mcqOptionsSchema.parse(item.options);
  if (!options.some((option) => option.id === response.option_id)) {
    throw new ReviewError(
      "invalid_response",
      `option ${response.option_id} is not an option of this item`,
    );
  }
  return response.option_id === item.answerOptionId;
}
