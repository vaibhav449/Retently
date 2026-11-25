import { randomUUID } from "node:crypto";
import type { Database } from "@repo/db";

export const NOTE_TEXT =
  "Mitochondria are the site of aerobic respiration and make most of the cell's ATP.";

export interface SeededMcq {
  itemId: string;
  prompt: string;
  /** Option texts. */
  right: string;
  wrong: string;
}

/**
 * One note owned by `userId`, with one MCQ generated from it. Stands in for question generation,
 * which is not wired in yet.
 */
export async function seedMcq(db: Database, userId: string): Promise<SeededMcq> {
  const source = await db.source.create({
    data: { ownerId: userId, kind: "note", title: "Biology — Cell structure" },
  });
  const chunk = await db.chunk.create({
    data: {
      sourceId: source.id,
      blockIds: ["blk_7f3a"],
      text: NOTE_TEXT,
      contentHash: randomUUID(),
    },
  });
  const right = { id: randomUUID(), text: "Mitochondrion" };
  const item = await db.item.create({
    data: {
      sourceChunkId: chunk.id,
      type: "mcq",
      prompt: "Which organelle is the site of aerobic respiration?",
      answer: right.text,
      options: [
        { id: randomUUID(), text: "Ribosome" },
        right,
        { id: randomUUID(), text: "Golgi apparatus" },
      ],
      answerOptionId: right.id,
    },
  });
  return { itemId: item.id, prompt: item.prompt, right: right.text, wrong: "Ribosome" };
}

const DAY_MS = 86_400_000;

/**
 * One note owned by `userId` with `count` MCQs on one chunk; the first `reviewed` of them get an
 * fsrs6-v1 card (stability 5 days, last reviewed 2 days ago, due in 3). Stands in for question
 * generation and a few days of reviews. Returns the note's topic key and the item ids.
 */
export async function seedNoteWithMcqs(
  db: Database,
  userId: string,
  opts: { title: string; count: number; reviewed: number },
): Promise<{ topicKey: string; itemIds: string[] }> {
  const source = await db.source.create({
    data: { ownerId: userId, kind: "note", title: opts.title },
  });
  const chunk = await db.chunk.create({
    data: { sourceId: source.id, blockIds: ["blk_1"], text: NOTE_TEXT, contentHash: randomUUID() },
  });
  const itemIds: string[] = [];
  for (let i = 0; i < opts.count; i += 1) {
    const right = { id: randomUUID(), text: `Right ${i + 1}` };
    const item = await db.item.create({
      data: {
        sourceChunkId: chunk.id,
        type: "mcq",
        prompt: `Exam question ${i + 1}?`,
        answer: right.text,
        options: [right, { id: randomUUID(), text: `Wrong ${i + 1}` }],
        answerOptionId: right.id,
      },
    });
    itemIds.push(item.id);
  }
  const now = Date.now();
  for (const itemId of itemIds.slice(0, opts.reviewed)) {
    const lastReviewAt = new Date(now - 2 * DAY_MS);
    const dueAt = new Date(now + 3 * DAY_MS);
    await db.cardState.create({
      data: {
        userId,
        itemId,
        schedulerVersion: "fsrs6-v1",
        state: {
          kind: "fsrs",
          last_review_at: lastReviewAt.toISOString(),
          due_at: dueAt.toISOString(),
          reps: 2,
          lapses: 0,
          difficulty: 5,
          stability: 5,
          scheduled_days: 5,
        },
        dueAt,
        updatedAt: lastReviewAt,
      },
    });
  }
  return { topicKey: `src:${source.id}`, itemIds };
}
