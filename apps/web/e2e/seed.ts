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
