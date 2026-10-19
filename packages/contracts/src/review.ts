import { z } from "zod";
import { citationSchema } from "./citation";
import { itemTypeSchema } from "./item";

/** Asked before the answer is revealed (v0.2 §7.2). */
export const confidenceSchema = z.enum(["sure", "think_so", "no_idea"]);

export const reviewContextSchema = z.enum(["solo", "duel"]);

/**
 * An item as shown before answering. Strict: an `answer` or `rubric` key makes it fail,
 * so the correct answer can't leak to the client.
 */
export const reviewQuestionSchema = z.strictObject({
  item_id: z.uuid(),
  type: itemTypeSchema,
  prompt: z.string().min(1),
  /** MCQ only; empty for other types. */
  options: z.array(z.string().min(1)),
});

/** GET /api/review/next. `item` is null when nothing is due. */
export const reviewNextResponseSchema = z.object({
  item: reviewQuestionSchema.nullable(),
});

/** POST /api/review/answer request body. Context is always `solo` on this route. */
export const reviewAnswerRequestSchema = z.object({
  item_id: z.uuid(),
  confidence: confidenceSchema,
  /** MCQ: the chosen option's text. Cloze and short answer: what the user typed. */
  response: z.string().min(1),
  /** From question shown to answer submitted, measured on the client. */
  latency_ms: z.number().int().nonnegative(),
});

/** POST /api/review/answer response. */
export const reviewAnswerResponseSchema = z.object({
  correct: z.boolean(),
  correct_answer: z.string().min(1),
  citation: citationSchema,
});

export type Confidence = z.infer<typeof confidenceSchema>;
export type ReviewContext = z.infer<typeof reviewContextSchema>;
export type ReviewQuestion = z.infer<typeof reviewQuestionSchema>;
export type ReviewNextResponse = z.infer<typeof reviewNextResponseSchema>;
export type ReviewAnswerRequest = z.infer<typeof reviewAnswerRequestSchema>;
export type ReviewAnswerResponse = z.infer<typeof reviewAnswerResponseSchema>;
