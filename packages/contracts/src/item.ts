import { z } from "zod";

export const itemTypeSchema = z.enum(["mcq", "cloze", "short_answer"]);

const itemBaseSchema = z.object({
  id: z.uuid(),
  source_chunk_id: z.uuid(),
  prompt: z.string().min(1),
  difficulty_seed: z.number().nullable(),
  created_at: z.iso.datetime(),
  retired_at: z.iso.datetime().nullable(),
});

/** Options are shuffled before storing. `answer` is the correct option's text. */
export const mcqItemSchema = itemBaseSchema
  .extend({
    type: z.literal("mcq"),
    answer: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(6),
    rubric: z.null(),
  })
  .refine((item) => item.options.includes(item.answer), {
    message: "answer must be one of the options",
    path: ["answer"],
  })
  .refine((item) => new Set(item.options).size === item.options.length, {
    message: "options must be unique",
    path: ["options"],
  });

/** `prompt` contains a blank (three or more underscores); `answer` is the hidden text. */
export const clozeItemSchema = itemBaseSchema
  .extend({
    type: z.literal("cloze"),
    answer: z.string().min(1),
    options: z.array(z.string()).max(0),
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
  options: z.array(z.string()).max(0),
  rubric: z.string().min(1),
});

/** A full item, including its answer. Server-side only; never send this to the client before reveal. */
export const itemSchema = z.discriminatedUnion("type", [
  mcqItemSchema,
  clozeItemSchema,
  shortAnswerItemSchema,
]);

export type ItemType = z.infer<typeof itemTypeSchema>;
export type McqItem = z.infer<typeof mcqItemSchema>;
export type ClozeItem = z.infer<typeof clozeItemSchema>;
export type ShortAnswerItem = z.infer<typeof shortAnswerItemSchema>;
export type Item = z.infer<typeof itemSchema>;
