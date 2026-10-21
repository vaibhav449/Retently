import { randomUUID } from "node:crypto";
import { createDb, type Database } from "@repo/db";
import { createRegistry, placeholderV0, type Scheduler } from "@repo/scheduler";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ReviewError, type ReviewErrorCode } from "../errors";
import { type RecordReviewDeps, type RecordReviewInput, recordReview } from "./recordReview";
import { uuidv7 } from "./uuidv7";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = createDb(inject("databaseUrl")));
});

afterAll(() => close());

const T0 = new Date("2026-10-21T09:00:00.000Z");
const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;
const at = (ms: number) => new Date(T0.getTime() + ms);
const placeholderOnly = () => createRegistry([placeholderV0], "placeholder-v0");

function depsAt(now: Date, registry = placeholderOnly()): RecordReviewDeps {
  return { db, clock: { now: () => now }, registry, grading: { fastRatio: 1 } };
}

interface Card {
  userId: string;
  itemId: string;
  /** Option ids. */
  right: string;
  wrong: string;
}

/** A user who owns one note with one MCQ, all with fresh ids so tests never collide. */
async function seedCard(): Promise<Card> {
  const userId = `user_${randomUUID()}`;
  const [right, wrong, other] = [randomUUID(), randomUUID(), randomUUID()];
  await db.user.create({
    data: { id: userId, name: "Test", email: `${userId}@example.com`, dob: new Date("2000-01-01") },
  });
  const source = await db.source.create({
    data: { ownerId: userId, kind: "note", title: "Biology" },
  });
  const chunk = await db.chunk.create({
    data: {
      sourceId: source.id,
      blockIds: [],
      text: "Mitochondria make ATP.",
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
  return { userId, itemId: item.id, right, wrong };
}

function answer(card: Card, optionId: string, when: Date, change: Partial<RecordReviewInput> = {}) {
  return {
    reviewId: uuidv7(when),
    userId: card.userId,
    itemId: card.itemId,
    context: "solo",
    confidence: "sure",
    response: { kind: "mcq", option_id: optionId },
    latencyMs: 4200,
    ...change,
  } satisfies RecordReviewInput;
}

async function stored(card: Card) {
  const log = await db.reviewLog.findMany({
    where: { userId: card.userId, itemId: card.itemId },
    orderBy: [{ reviewedAt: "asc" }, { id: "asc" }],
  });
  const state = await db.cardState.findUnique({
    where: { userId_itemId: { userId: card.userId, itemId: card.itemId } },
  });
  return { log, state };
}

async function errorCode(attempt: Promise<unknown>): Promise<ReviewErrorCode | "no error"> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof ReviewError) return error.code;
    throw error;
  }
  return "no error";
}

describe("recordReview: the happy path", () => {
  it("records a first review as one review_log row and one card_state row", async () => {
    const card = await seedCard();
    const input = answer(card, card.right, T0);
    const outcome = await recordReview(input, depsAt(T0));

    expect(outcome).toEqual({
      reviewId: input.reviewId,
      itemId: card.itemId,
      correct: true,
      grade: 3, // Sure and correct, but no latency median yet: Good, never Easy
      misconception: false,
      retrievabilityBefore: null,
      nextDueAt: at(DAY),
      idempotentReplay: false,
    });

    const { log, state } = await stored(card);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      id: input.reviewId,
      reviewedAt: T0,
      grade: 3,
      confidence: "sure",
      correct: true,
      response: { kind: "mcq", option_id: card.right },
      latencyMs: 4200,
      elapsedDays: null,
      context: "solo",
      schedulerVersion: "placeholder-v0",
    });
    expect(state).toMatchObject({
      schedulerVersion: "placeholder-v0",
      dueAt: at(DAY),
      misconceptionUntil: null,
      updatedAt: T0,
      state: { kind: "placeholder", reps: 1, lapses: 0, last_review_at: T0.toISOString() },
    });
  });

  it("advances the card next day: a confident wrong answer is Again and a misconception", async () => {
    const card = await seedCard();
    await recordReview(answer(card, card.right, T0), depsAt(T0));
    const outcome = await recordReview(answer(card, card.wrong, at(DAY)), depsAt(at(DAY)));

    expect(outcome).toMatchObject({ correct: false, grade: 1, misconception: true });
    expect(outcome.retrievabilityBefore).toBeCloseTo(0.9, 10);
    const { log, state } = await stored(card);
    expect(log.map((row) => [row.grade, row.elapsedDays])).toEqual([
      [3, null],
      [1, 1],
    ]);
    expect(state?.state).toMatchObject({ reps: 2, lapses: 1 });
  });
});

describe("recordReview: idempotency and concurrency", () => {
  it("records a double submit of the same presentation once and replays the first result", async () => {
    const card = await seedCard();
    const input = answer(card, card.right, T0);
    const first = await recordReview(input, depsAt(T0));
    const again = await recordReview(input, depsAt(at(2 * SECOND)));

    expect(again).toEqual({ ...first, retrievabilityBefore: null, idempotentReplay: true });
    const { log, state } = await stored(card);
    expect(log).toHaveLength(1);
    expect(state?.state).toMatchObject({ reps: 1 });
  });

  it("writes one row when the same presentation is submitted twice at the same moment", async () => {
    const card = await seedCard();
    const input = answer(card, card.right, T0);
    const results = await Promise.all([
      recordReview(input, depsAt(T0)),
      recordReview(input, depsAt(T0)),
    ]);

    expect(results.map((result) => result.idempotentReplay).sort()).toEqual([false, true]);
    expect((await stored(card)).log).toHaveLength(1);
  });

  it("serialises parallel answers to one card, so no update is lost", async () => {
    const card = await seedCard();
    // Duel answers skip the 30-second guard, so all five are real, separate answers.
    const answers = Array.from({ length: 5 }, (_, i) =>
      answer(card, card.right, at(i), { context: "duel", confidence: null }),
    );
    await Promise.all(answers.map((input) => recordReview(input, depsAt(T0))));

    const { log, state } = await stored(card);
    expect(log).toHaveLength(5);
    expect(state?.state).toMatchObject({ reps: 5 });
  });

  it("refuses a second solo answer from another tab within 30 seconds, and accepts one after", async () => {
    const card = await seedCard();
    await recordReview(answer(card, card.right, T0), depsAt(T0));
    const tooSoon = at(10 * SECOND);
    const later = at(31 * SECOND);

    expect(await errorCode(recordReview(answer(card, card.right, tooSoon), depsAt(tooSoon)))).toBe(
      "duplicate_answer",
    );
    expect(await errorCode(recordReview(answer(card, card.right, later), depsAt(later)))).toBe(
      "no error",
    );
    expect((await stored(card)).log).toHaveLength(2);
  });

  it("refuses a review id that already belongs to another item", async () => {
    const first = await seedCard();
    const second = await seedCard();
    const input = answer(first, first.right, T0);
    await recordReview(input, depsAt(T0));

    const reused = { ...answer(second, second.right, T0), reviewId: input.reviewId };
    expect(await errorCode(recordReview(reused, depsAt(T0)))).toBe("review_id_conflict");
  });
});

describe("recordReview: what it refuses", () => {
  it("refuses items that don't exist, belong to someone else, or were retired", async () => {
    const card = await seedCard();
    const someoneElse = await seedCard();
    const missing = { ...answer(card, card.right, T0), itemId: randomUUID() };
    const notTheirs = { ...answer(card, card.right, T0), itemId: someoneElse.itemId };
    await db.item.update({ where: { id: card.itemId }, data: { retiredAt: T0 } });

    expect(await errorCode(recordReview(missing, depsAt(T0)))).toBe("item_not_found");
    expect(await errorCode(recordReview(notTheirs, depsAt(T0)))).toBe("forbidden");
    expect(await errorCode(recordReview(answer(card, card.right, T0), depsAt(T0)))).toBe(
      "item_retired",
    );
  });

  it("refuses an option that is not on the item, and writes nothing", async () => {
    const card = await seedCard();
    expect(await errorCode(recordReview(answer(card, randomUUID(), T0), depsAt(T0)))).toBe(
      "invalid_response",
    );
    expect(await stored(card)).toEqual({ log: [], state: null });
  });
});

describe("recordReview: atomicity", () => {
  it("writes nothing when the review_log insert fails", async () => {
    const card = await seedCard();
    // latency_ms < 0 breaks a CHECK constraint on review_log.
    await expect(
      recordReview(answer(card, card.right, T0, { latencyMs: -1 }), depsAt(T0)),
    ).rejects.toThrow(/review_log_latency_ms_check/);
    expect(await stored(card)).toEqual({ log: [], state: null });
  });

  it("rolls the review_log row back when writing card_state fails after it", async () => {
    const card = await seedCard();
    const broken: Scheduler = {
      ...placeholderV0,
      version: "broken-v0",
      next: (state, grade, now) => ({ ...placeholderV0.next(state, grade, now), due_at: null }),
    };
    const registry = createRegistry([broken], "broken-v0");

    await expect(recordReview(answer(card, card.right, T0), depsAt(T0, registry))).rejects.toThrow(
      /without due_at/,
    );
    expect(await stored(card)).toEqual({ log: [], state: null });
  });

  it("keeps advancing a card with the scheduler that wrote it, not the active one", async () => {
    const card = await seedCard();
    const testV1: Scheduler = { ...placeholderV0, version: "test-v1" };
    await recordReview(answer(card, card.right, T0), depsAt(T0));
    const tomorrow = at(DAY);
    await recordReview(
      answer(card, card.right, tomorrow),
      depsAt(tomorrow, createRegistry([placeholderV0, testV1], "test-v1")),
    );

    const { log, state } = await stored(card);
    expect(log.map((row) => row.schedulerVersion)).toEqual(["placeholder-v0", "placeholder-v0"]);
    expect(state?.schedulerVersion).toBe("placeholder-v0");
  });
});
