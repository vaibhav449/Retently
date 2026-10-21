import { z } from "zod";
import { citationSchema } from "./citation";
import { itemTypeSchema, mcqOptionSchema } from "./item";

/** Asked before the answer is revealed (v0.2 §7.2). */
export const confidenceSchema = z.enum(["sure", "think_so", "no_idea"]);

export const reviewContextSchema = z.enum(["solo", "duel"]);

/** Why an item is in today's session: a due review, a misconception retest, or a new item. */
export const reviewCategorySchema = z.enum(["review", "misconception", "new"]);

/** 1 Again · 2 Hard · 3 Good · 4 Easy. */
export const gradeSchema = z.literal([1, 2, 3, 4]);

/**
 * What the student answered. Sent with the answer and stored as review_log.response (jsonb), so
 * "you answered X" can be shown later. An MCQ answer names an option by id, never by text or position.
 */
export const reviewResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("mcq"), option_id: z.uuid() }),
  z.strictObject({ kind: z.literal("text"), text: z.string().min(1) }),
]);

/**
 * An item as presented, before it is answered. Strict at both levels, so an answer, answer id,
 * rubric or correct flag makes it fail: nothing that reveals the answer can reach the client.
 */
export const reviewItemViewSchema = z.strictObject({
  /**
   * Opaque to the client: send it back with the answer. The server signs it when it presents the
   * item and uses it to tie the answer to that presentation (idempotency), to check the item was
   * shown to this user, and to time the answer. Its format is the server's business.
   */
  presentation_token: z.string().min(1),
  category: reviewCategorySchema,
  item: z
    .strictObject({
      id: z.uuid(),
      type: itemTypeSchema,
      prompt: z.string().min(1),
      /** MCQ only, shuffled for this presentation; empty for other types. */
      options: z.array(mcqOptionSchema),
    })
    .refine(
      (item) => (item.type === "mcq" ? item.options.length >= 2 : item.options.length === 0),
      {
        message: "an MCQ needs its options; other types have none",
        path: ["options"],
      },
    ),
});

export const sessionProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  planned: z.number().int().nonnegative(),
});

/** GET /api/review/next. */
export const reviewNextResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), item: reviewItemViewSchema, progress: sessionProgressSchema }),
  /** Today's plan is finished; `can_extend` offers "study more". */
  z.object({ state: z.literal("done_for_today"), can_extend: z.boolean() }),
  /** Nothing is due today and there are no new items. */
  z.object({ state: z.literal("nothing_due") }),
]);

/** POST /api/review/answer request body. Solo answers only; duel answers go through the duel server. */
export const reviewAnswerRequestSchema = z.object({
  presentation_token: z.string().min(1),
  confidence: confidenceSchema,
  response: reviewResponseSchema,
  /**
   * Measured on the client, from first render to submit. The server keeps the smaller of this and
   * its own time since presentation, clamped to [0, 600 000], so a bad value is fixed, not refused.
   */
  client_latency_ms: z.number().int(),
});

/** The outcome of one answer: returned by the answer route, or sent on /events for short answers. */
export const reviewResultSchema = z.object({
  /** = review_log.id, minted when the item was presented. */
  review_id: z.uuid(),
  item_id: z.uuid(),
  correct: z.boolean(),
  correct_answer: z.string().min(1),
  /** Short answers only: the grader's feedback and the rubric, shown after the reveal. */
  feedback: z.string().min(1).optional(),
  rubric: z.string().min(1).optional(),
  citation: citationSchema,
  grade: gradeSchema,
  /** Probability of recall just before this answer; null on the first review. */
  retrievability_before: z.number().min(0).max(1).nullable(),
  next_due_at: z.iso.datetime(),
  scheduled_days: z.number().int().nonnegative(),
  /** Only for a confident wrong answer: the material for "You were confident that X". */
  misconception: z
    .object({
      your_answer: z.string().min(1),
      correct_answer: z.string().min(1),
      citation: citationSchema,
    })
    .optional(),
  /** True when this presentation had already been answered (a double submit): nothing new was written. */
  idempotent_replay: z.boolean(),
});

/** POST /api/review/answer response: graded now (200), or a short answer handed to the worker (202). */
export const reviewAnswerResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("graded"), result: reviewResultSchema }),
  z.object({ status: z.literal("grading"), review_id: z.uuid() }),
]);

/** POST /api/review/session: today's plan, created on the first call of the day and reused after. */
export const reviewSessionViewSchema = z.object({
  session_id: z.uuid(),
  /** The day in the student's own time zone. */
  local_date: z.iso.date(),
  budget_sec: z.number().int().positive(),
  remaining_sec: z.number().int().nonnegative(),
  planned: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  composition: z.object({
    review: z.number().int().nonnegative(),
    misconception: z.number().int().nonnegative(),
    new: z.number().int().nonnegative(),
  }),
  exam_ids: z.array(z.uuid()),
});

export type Confidence = z.infer<typeof confidenceSchema>;
export type ReviewContext = z.infer<typeof reviewContextSchema>;
export type ReviewCategory = z.infer<typeof reviewCategorySchema>;
export type ReviewGrade = z.infer<typeof gradeSchema>;
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;
export type ReviewItemView = z.infer<typeof reviewItemViewSchema>;
export type SessionProgress = z.infer<typeof sessionProgressSchema>;
export type ReviewNextResponse = z.infer<typeof reviewNextResponseSchema>;
export type ReviewAnswerRequest = z.infer<typeof reviewAnswerRequestSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type ReviewAnswerResponse = z.infer<typeof reviewAnswerResponseSchema>;
export type ReviewSessionView = z.infer<typeof reviewSessionViewSchema>;
