import { randomUUID } from "node:crypto";
import type { Database } from "@repo/db";

export interface SeededMcq {
  userId: string;
  itemId: string;
  chunkId: string;
  /** Option ids. */
  right: string;
  wrong: string;
}

/** A user who owns one note with one MCQ. Fresh ids every time, so tests never collide. */
export async function seedUserWithMcq(db: Database): Promise<SeededMcq> {
  const userId = `user_${randomUUID()}`;
  const [right, wrong, other] = [randomUUID(), randomUUID(), randomUUID()];
  await db.user.create({
    data: { id: userId, name: "Test", email: `${userId}@example.com`, dob: new Date("2000-01-01") },
  });
  const source = await db.source.create({
    data: { ownerId: userId, kind: "note", title: "Biology — Cell structure" },
  });
  const chunk = await db.chunk.create({
    data: {
      sourceId: source.id,
      blockIds: ["blk_7f3a"],
      text: "Mitochondria are the site of aerobic respiration and make most of the cell's ATP.",
      contentHash: randomUUID(),
    },
  });
  const item = await db.item.create({
    data: {
      sourceChunkId: chunk.id,
      type: "mcq",
      prompt: "Which organelle is the site of aerobic respiration?",
      answer: "Mitochondrion",
      options: [
        { id: wrong, text: "Ribosome" },
        { id: right, text: "Mitochondrion" },
        { id: other, text: "Golgi apparatus" },
      ],
      answerOptionId: right,
    },
  });
  return { userId, itemId: item.id, chunkId: chunk.id, right, wrong };
}
