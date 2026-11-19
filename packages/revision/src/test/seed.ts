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

const DAY_MS = 86_400_000;

/** Bulk inserts in batches, well inside Postgres' limit on bind parameters per statement. */
function batches<T>(rows: readonly T[], size = 1_000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * `count` MCQs owned by `userId`, spread round-robin over `sources` new notes (one chunk each),
 * written with createMany: for bulk tests. Item ids in creation order.
 */
export async function seedMcqs(
  db: Database,
  userId: string,
  count: number,
  opts: { sources?: number } = {},
): Promise<{ itemIds: string[]; sourceIds: string[] }> {
  const sourceCount = Math.max(1, Math.min(count, opts.sources ?? count));
  const sources = Array.from({ length: sourceCount }, (_, i) => ({
    id: randomUUID(),
    ownerId: userId,
    kind: "note" as const,
    title: `Note ${i + 1}`,
  }));
  const chunks = sources.map((source) => ({
    id: randomUUID(),
    sourceId: source.id,
    blockIds: ["blk_1"],
    text: "Mitochondria are the site of aerobic respiration.",
    contentHash: randomUUID(),
  }));
  const items = Array.from({ length: count }, (_, i) => {
    const right = randomUUID();
    return {
      id: randomUUID(),
      sourceChunkId: (chunks[i % chunks.length] as { id: string }).id,
      type: "mcq" as const,
      prompt: `Question ${i + 1}?`,
      answer: "Right",
      options: [
        { id: right, text: "Right" },
        { id: randomUUID(), text: "Wrong" },
      ],
      answerOptionId: right,
    };
  });
  for (const batch of batches(sources)) await db.source.createMany({ data: batch });
  for (const batch of batches(chunks)) await db.chunk.createMany({ data: batch });
  for (const batch of batches(items)) await db.item.createMany({ data: batch });
  return { itemIds: items.map((item) => item.id), sourceIds: sources.map((source) => source.id) };
}

export interface CardFixture {
  itemId: string;
  dueAt: Date;
  /** FSRS stability in days; last reviewed this long before dueAt. Default 10. */
  stability?: number;
  misconceptionUntil?: Date | null;
}

/** fsrs6-v1 card_state rows written directly (no review_log): for queue tests. */
export async function seedCardStates(
  db: Database,
  userId: string,
  rows: CardFixture[],
): Promise<void> {
  const data = rows.map((row) => {
    const stability = row.stability ?? 10;
    const lastReviewAt = new Date(row.dueAt.getTime() - stability * DAY_MS);
    return {
      userId,
      itemId: row.itemId,
      schedulerVersion: "fsrs6-v1",
      state: {
        kind: "fsrs",
        difficulty: 5,
        stability,
        last_review_at: lastReviewAt.toISOString(),
        due_at: row.dueAt.toISOString(),
        reps: 3,
        lapses: 0,
        scheduled_days: Math.max(1, Math.round(stability)),
      },
      dueAt: row.dueAt,
      misconceptionUntil: row.misconceptionUntil ?? null,
      updatedAt: lastReviewAt,
    };
  });
  for (const batch of batches(data)) await db.cardState.createMany({ data: batch });
}

/** Creates or changes `userId`'s revision_settings row. */
export async function setRevisionSettings(
  db: Database,
  userId: string,
  data: { timezone?: string; dailyBudgetSec?: number },
): Promise<void> {
  await db.revisionSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

/** A review_pending row for `itemId`, as the short-answer path will write it. */
export async function markPending(
  db: Database,
  userId: string,
  itemId: string,
  submittedAt: Date,
): Promise<void> {
  await db.reviewPending.create({
    data: {
      reviewId: randomUUID(),
      userId,
      itemId,
      confidence: "sure",
      response: { kind: "text", text: "pending" },
      latencyMs: 4_000,
      submittedAt,
      status: "queued",
    },
  });
}
