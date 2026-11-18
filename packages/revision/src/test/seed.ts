import { randomUUID } from "node:crypto";
import type { Confidence, ItemType, ReviewContext } from "@repo/contracts";
import type { Database } from "@repo/db";

export interface SeededMcq {
  userId: string;
  itemId: string;
  chunkId: string;
  /** Option ids. */
  right: string;
  wrong: string;
}

/** A user with nothing else. Fresh ids every time, so tests never collide. */
export async function seedUser(db: Database): Promise<string> {
  const userId = `user_${randomUUID()}`;
  await db.user.create({
    data: { id: userId, name: "Test", email: `${userId}@example.com`, dob: new Date("2000-01-01") },
  });
  return userId;
}

/** One more note owned by `userId`, with one MCQ on it. */
export async function seedMcq(db: Database, userId: string): Promise<Omit<SeededMcq, "userId">> {
  const [right, wrong, other] = [randomUUID(), randomUUID(), randomUUID()];
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
  return { itemId: item.id, chunkId: chunk.id, right, wrong };
}

/** A user who owns one note with one MCQ. Fresh ids every time, so tests never collide. */
export async function seedUserWithMcq(db: Database): Promise<SeededMcq> {
  const userId = await seedUser(db);
  return { userId, ...(await seedMcq(db, userId)) };
}

/** An item of any type on a new note owned by `userId`; MCQs get options, others none. */
export async function seedItem(db: Database, userId: string, type: ItemType): Promise<string> {
  if (type === "mcq") return (await seedMcq(db, userId)).itemId;
  const source = await db.source.create({
    data: { ownerId: userId, kind: "note", title: "Notes" },
  });
  const chunk = await db.chunk.create({
    data: { sourceId: source.id, blockIds: [], text: "Text.", contentHash: randomUUID() },
  });
  const item = await db.item.create({
    data: { sourceChunkId: chunk.id, type, prompt: "Fill in the gap.", answer: "gap", options: [] },
  });
  return item.id;
}

export interface LogFixture {
  userId: string;
  itemId: string;
  reviewedAt: Date;
  latencyMs: number;
  context?: ReviewContext;
  /** Defaults to a random v4 UUID. */
  id?: string;
  confidence?: Confidence | null;
  correct?: boolean;
  grade?: number;
}

/**
 * review_log rows written directly, for tests that need exact control of the log (the latency
 * median). Not for card_state tests: these rows have no matching card_state.
 */
export async function insertReviewLog(db: Database, rows: LogFixture[]): Promise<string[]> {
  const data = rows.map((row) => {
    const context = row.context ?? "solo";
    return {
      id: row.id ?? randomUUID(),
      userId: row.userId,
      itemId: row.itemId,
      reviewedAt: row.reviewedAt,
      latencyMs: row.latencyMs,
      context,
      confidence:
        row.confidence !== undefined ? row.confidence : context === "duel" ? null : "sure",
      correct: row.correct ?? true,
      grade: row.grade ?? 3,
      schedulerVersion: "fsrs6-v1",
    };
  });
  await db.reviewLog.createMany({ data });
  return data.map((row) => row.id);
}

/** Gives `userId` a revision_settings row with this zone. */
export async function setTimeZone(db: Database, userId: string, timezone: string): Promise<void> {
  await db.revisionSettings.create({ data: { userId, timezone } });
}
