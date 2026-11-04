import { randomInt, randomUUID } from "node:crypto";
import { type McqItem, mcqItemSchema } from "@repo/contracts";
import { z } from "zod";

/** What the model is asked for. Option ids, shuffling and the item shape are added here. */
export const mcqDraftSchema = z.object({
  question: z.string().min(1).max(500),
  correct_answer: z.string().min(1).max(200),
  wrong_answers: z.array(z.string().min(1).max(200)).min(2).max(4),
});

export type McqDraft = z.infer<typeof mcqDraftSchema>;

export const MCQ_INSTRUCTIONS = `You write one multiple-choice question that checks whether a student understood a passage from their own study notes.

- Ask about the most important idea in the passage. The question must be answerable from the passage alone, without the rest of the notes.
- Give exactly one correct answer, supported by the passage.
- Give three wrong answers that a student who misread or half-remembered the passage might pick. Each must be clearly wrong according to the passage, and about as long as the correct answer.
- Do not use "all of the above", "none of the above", or answers that only differ in wording.
- Write in the language of the passage. Keep the question under 30 words and each answer under 15 words.`;

/** The user content of the request: the passage, with its headings for context. */
export function mcqPrompt(chunk: { heading: string | null; text: string }): string {
  const section = chunk.heading ? `<section>${chunk.heading}</section>\n\n` : "";
  return `${section}<passage>\n${chunk.text}\n</passage>`;
}

/** Fisher–Yates with a cryptographic source, so the right answer's position carries no pattern. */
function shuffle<T>(values: T[], random: (max: number) => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/**
 * The stored MCQ for a draft: options shuffled once here and given ids that never change, in the
 * agreed item shape (mcqItemSchema). Null when the draft cannot make a fair question: a wrong
 * answer repeating the right one, or fewer than two distinct options left.
 */
export function buildMcqItem(
  draft: McqDraft,
  sourceChunkId: string,
  createdAt: Date,
  random: (max: number) => number = randomInt,
): McqItem | null {
  const answer = draft.correct_answer.trim();
  const seen = new Set([answer.toLowerCase()]);
  const wrong: string[] = [];
  for (const text of draft.wrong_answers.map((value) => value.trim())) {
    const key = text.toLowerCase();
    if (!text) continue;
    // A "wrong" answer equal to the right one would make the question unfair.
    if (key === answer.toLowerCase()) return null;
    if (seen.has(key)) continue;
    seen.add(key);
    wrong.push(text);
  }
  if (!answer || wrong.length === 0) return null;

  const options = shuffle(
    [answer, ...wrong].map((text) => ({ id: randomUUID(), text })),
    random,
  );
  const parsed = mcqItemSchema.safeParse({
    id: randomUUID(),
    source_chunk_id: sourceChunkId,
    type: "mcq",
    prompt: draft.question.trim(),
    answer,
    options,
    answer_option_id: options.find((option) => option.text === answer)?.id,
    rubric: null,
    difficulty_seed: null,
    created_at: createdAt.toISOString(),
    retired_at: null,
  });
  return parsed.success ? parsed.data : null;
}
