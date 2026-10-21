import { z } from "zod";

export const itemTypeSchema = z.enum(["mcq", "cloze", "short_answer"]);

/**
 * One MCQ choice. The id is minted once, when the item is created, and never changes, even if the
 * text is edited later. Answers and review_log refer to the id, never to the text or a position.
 */
export const mcqOptionSchema = z.strictObject({
  id: z.uuid(),
  text: z.string().min(1),
});

const itemBaseSchema = z.object({
  id: z.uuid(),
  source_chunk_id: z.uuid(),
  prompt: z.string().min(1),
  difficulty_seed: z.number().nullable(),
  created_at: z.iso.datetime(),
  retired_at: z.iso.datetime().nullable(),
});

/** Graded by id: the chosen option_id must equal `answer_option_id`. `answer` is its text. */
export const mcqItemSchema = itemBaseSchema
  .extend({
    type: z.literal("mcq"),
    answer: z.string().min(1),
    /** Shuffled again at every presentation, so stored order does not matter. */
    options: z.array(mcqOptionSchema).min(2).max(6),
    answer_option_id: z.uuid(),
    rubric: z.null(),
  })
  .refine((item) => new Set(item.options.map((option) => option.id)).size === item.options.length, {
    message: "option ids must be unique",
    path: ["options"],
  })
  .refine(
    (item) => new Set(item.options.map((option) => option.text)).size === item.options.length,
    { message: "options must be unique", path: ["options"] },
  )
  .refine(
    (item) =>
      item.options.some(
        (option) => option.id === item.answer_option_id && option.text === item.answer,
      ),
    {
      message: "answer_option_id must name the option whose text is the answer",
      path: ["answer_option_id"],
    },
  );

/** `prompt` contains a blank (three or more underscores); `answer` is the hidden text. */
export const clozeItemSchema = itemBaseSchema
  .extend({
    type: z.literal("cloze"),
    answer: z.string().min(1),
    options: z.array(mcqOptionSchema).max(0),
    answer_option_id: z.null(),
    rubric: z.null(),
  })
  .refine((item) => /_{3,}/.test(item.prompt), {
    message: "cloze prompt must contain a blank (___)",
    path: ["prompt"],
  });

/** Graded by an LLM against `rubric`; `answer` is a model answer. */
export const shortAnswerItemSchema = itemBaseSchema.extend({
  type: z.literal("short_answer"),
  answer: z.string().min(1),
  options: z.array(mcqOptionSchema).max(0),
  answer_option_id: z.null(),
  rubric: z.string().min(1),
});

/** A full item, including its answer. Server-side only; never send this to the client before reveal. */
export const itemSchema = z.discriminatedUnion("type", [
  mcqItemSchema,
  clozeItemSchema,
  shortAnswerItemSchema,
]);

export type ItemType = z.infer<typeof itemTypeSchema>;
export type McqOption = z.infer<typeof mcqOptionSchema>;
export type McqItem = z.infer<typeof mcqItemSchema>;
export type ClozeItem = z.infer<typeof clozeItemSchema>;
export type ShortAnswerItem = z.infer<typeof shortAnswerItemSchema>;
export type Item = z.infer<typeof itemSchema>;
