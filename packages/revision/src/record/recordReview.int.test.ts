import { randomUUID } from "node:crypto";
import { createDb, type Database } from "@repo/db";
import { createRegistry, placeholderV0, type Scheduler } from "@repo/scheduler";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDefaultRegistry, DEFAULT_GRADING, DEFAULT_TIME_ZONE } from "../config";
import { ReviewError, type ReviewErrorCode } from "../errors";
import { effectiveDueAt } from "../misconception";
import { seedMcq, setTimeZone } from "../test/seed";
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
  return { db, clock: { now: () => now }, registry, grading: DEFAULT_GRADING };
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
      misconceptionUntil: null,
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

// ─── VS1: latency-relative grading (AC4, R1.1–R1.4) ─────────────────────────

describe("recordReview: Sure + correct is Easy only when fast against the user's median", () => {
  const STEP = 31 * SECOND; // past the 30-second duplicate guard

  /** Prior answers to `card`, one per latency, `STEP` apart from T0; returns the next free time. */
  async function history(card: Card, latencies: number[], change: Partial<RecordReviewInput> = {}) {
    let when = T0;
    for (const latencyMs of latencies) {
      await recordReview(
        answer(card, card.right, when, { confidence: "think_so", latencyMs, ...change }),
        depsAt(when),
      );
      when = new Date(when.getTime() + STEP);
    }
    return when;
  }

  async function sureCorrect(card: Card, when: Date, latencyMs: number) {
    return (await recordReview(answer(card, card.right, when, { latencyMs }), depsAt(when))).grade;
  }

  const tenAt = (ms: number) => Array<number>(10).fill(ms);

  it("after 10 solo answers at 10 s: 9 s is Easy, 11 s is Good", async () => {
    const fast = await seedCard();
    expect(await sureCorrect(fast, await history(fast, tenAt(10_000)), 9_000)).toBe(4);
    const slow = await seedCard();
    expect(await sureCorrect(slow, await history(slow, tenAt(10_000)), 11_000)).toBe(3);
  });

  it("is Good with only 9 solo answers, however fast (cold start, R1.3)", async () => {
    const card = await seedCard();
    expect(await sureCorrect(card, await history(card, tenAt(10_000).slice(1)), 1)).toBe(3);
  });

  it("leaves the answer being graded out of its own median (R1.2)", async () => {
    const card = await seedCard();
    // Median 10 000; with this answer counted it would be 10 500, and 10 500 ms would be Easy.
    const next = await history(card, [...tenAt(8_000).slice(5), ...tenAt(12_000).slice(5)]);
    expect(await sureCorrect(card, next, 10_500)).toBe(3);
  });

  it("leaves duel answers out of the median (R1.2)", async () => {
    const card = await seedCard();
    const afterSolo = await history(card, tenAt(10_000));
    // Ten fast duel answers after them; counted, they would pull the median down to 5 500.
    for (let i = 0; i < 10; i++) {
      const when = new Date(afterSolo.getTime() + i * SECOND);
      await recordReview(
        answer(card, card.right, when, { context: "duel", confidence: null, latencyMs: 1_000 }),
        depsAt(when),
      );
    }
    expect(await sureCorrect(card, new Date(afterSolo.getTime() + 31 * SECOND), 9_000)).toBe(4);
  });

  it("does not count an idle answer over 120 s toward the 10 samples (E16)", async () => {
    const card = await seedCard();
    const next = await history(card, [...tenAt(10_000).slice(1), 200_000]);
    expect(await sureCorrect(card, next, 1)).toBe(3);
  });

  it("keeps Think so + correct at Hard, however fast", async () => {
    const card = await seedCard();
    const next = await history(card, tenAt(10_000));
    const outcome = await recordReview(
      answer(card, card.right, next, { confidence: "think_so", latencyMs: 1 }),
      depsAt(next),
    );
    expect(outcome.grade).toBe(2);
  });

  it("takes the median per (user, item type), across the user's items", async () => {
    const first = await seedCard();
    const second = { userId: first.userId, ...(await seedMcq(db, first.userId)) };
    // All ten answers are to the second MCQ; they make the median for the first one too.
    const next = await history(second, tenAt(10_000));
    expect(await sureCorrect(first, next, 9_000)).toBe(4);
  });
});

// ─── VS1: the misconception override (AC2, AC3, R2.1–R2.5, R3.2) ────────────

describe("recordReview: a solo Sure + wrong sets misconception_until to the next local midnight", () => {
  /** 21:00 IST on 18 Nov 2026. */
  const T = new Date("2026-11-18T15:30:00.000Z");
  /** 00:00 IST on 19 Nov 2026. */
  const NEXT_IST_MIDNIGHT = new Date("2026-11-18T18:30:00.000Z");
  const fsrsAt = (now: Date) => depsAt(now, createDefaultRegistry());

  const cardRow = (card: Card) =>
    db.cardState.findUniqueOrThrow({
      where: { userId_itemId: { userId: card.userId, itemId: card.itemId } },
    });

  /** The mature card of 04-scheduler.md §6.4: S 100, answered exactly at its due date. */
  async function seedMatureCard(card: Card, dueAt: Date) {
    const lastReviewAt = new Date(dueAt.getTime() - 100 * DAY);
    await db.cardState.create({
      data: {
        userId: card.userId,
        itemId: card.itemId,
        schedulerVersion: "fsrs6-v1",
        state: {
          kind: "fsrs",
          difficulty: 5,
          stability: 100,
          last_review_at: lastReviewAt.toISOString(),
          due_at: dueAt.toISOString(),
          reps: 5,
          lapses: 0,
          scheduled_days: 100,
        },
        dueAt,
        updatedAt: lastReviewAt,
      },
    });
  }

  it("AC2: brings a mature card (S 100, FSRS says 4 days) back from the next local day", async () => {
    // Seeded without a log on purpose: the I2 tests only look at their own users.
    const card = await seedCard();
    await seedMatureCard(card, T);

    const outcome = await recordReview(answer(card, card.wrong, T), fsrsAt(T));

    const fsrsDue = new Date("2026-11-22T15:30:00.000Z");
    expect(outcome).toMatchObject({
      grade: 1,
      misconception: true,
      nextDueAt: fsrsDue,
      misconceptionUntil: NEXT_IST_MIDNIGHT,
    });
    const row = await cardRow(card);
    expect(row.dueAt).toEqual(fsrsDue); // FSRS's due date, untouched (I3)
    expect(row.misconceptionUntil).toEqual(NEXT_IST_MIDNIGHT);
    expect(effectiveDueAt(row)).toEqual(NEXT_IST_MIDNIGHT);
  });

  it("on a fresh card at 21:00, leaves due_at at +1 day and offers it from midnight (E6)", async () => {
    const card = await seedCard();
    await recordReview(answer(card, card.wrong, T), fsrsAt(T));
    const row = await cardRow(card);
    expect(row.dueAt).toEqual(new Date(T.getTime() + DAY));
    expect(row.misconceptionUntil).toEqual(NEXT_IST_MIDNIGHT);
  });

  const nextReviews: [string, Partial<RecordReviewInput>, boolean][] = [
    ["Think so + correct", { confidence: "think_so" }, true],
    ["Sure + correct", {}, true],
    ["No idea + wrong", { confidence: "no_idea" }, false],
    ["a duel, right", { context: "duel", confidence: null }, true],
    ["a duel, wrong", { context: "duel", confidence: null }, false],
  ];
  it.each(nextReviews)(
    "AC3: the next review clears it when it is %s (DD-13)",
    async (_, change, right) => {
      const card = await seedCard();
      await recordReview(answer(card, card.wrong, T), fsrsAt(T));
      const later = new Date(T.getTime() + DAY);
      const outcome = await recordReview(
        answer(card, right ? card.right : card.wrong, later, change),
        fsrsAt(later),
      );
      expect(outcome.misconceptionUntil).toBeNull();
      expect((await cardRow(card)).misconceptionUntil).toBeNull();
    },
  );

  it("sets it again from the newer review after a second Sure + wrong (E10)", async () => {
    const card = await seedCard();
    await recordReview(answer(card, card.wrong, T), fsrsAt(T));
    const later = new Date(T.getTime() + DAY);
    await recordReview(answer(card, card.wrong, later), fsrsAt(later));
    expect((await cardRow(card)).misconceptionUntil).toEqual(
      new Date(NEXT_IST_MIDNIGHT.getTime() + DAY),
    );
  });

  it("is never set by a duel answer (R2.4)", async () => {
    const card = await seedCard();
    const duel = { context: "duel", confidence: null } as const;
    await recordReview(answer(card, card.wrong, T, duel), fsrsAt(T));
    expect((await cardRow(card)).misconceptionUntil).toBeNull();
  });

  it("uses the user's zone: UTC gives the next UTC midnight", async () => {
    const card = await seedCard();
    await setTimeZone(db, card.userId, "UTC");
    await recordReview(answer(card, card.wrong, T), fsrsAt(T));
    expect((await cardRow(card)).misconceptionUntil).toEqual(new Date("2026-11-19T00:00:00.000Z"));
  });

  it("uses the user's zone across New York's DST change", async () => {
    const card = await seedCard();
    await setTimeZone(db, card.userId, "America/New_York");
    const sunday = new Date("2026-11-01T15:00:00.000Z"); // 10:00 EST, a 25-hour day
    await recordReview(answer(card, card.wrong, sunday), fsrsAt(sunday));
    expect((await cardRow(card)).misconceptionUntil).toEqual(new Date("2026-11-02T05:00:00.000Z"));
  });

  it("uses Asia/Kolkata without a revision_settings row, and creates none (R3.2, E7)", async () => {
    const card = await seedCard();
    await recordReview(answer(card, card.wrong, T), fsrsAt(T));
    expect((await cardRow(card)).misconceptionUntil).toEqual(NEXT_IST_MIDNIGHT);
    expect(await db.revisionSettings.count({ where: { userId: card.userId } })).toBe(0);
  });

  it("uses Asia/Kolkata when the stored zone is unknown (E8)", async () => {
    const card = await seedCard();
    await setTimeZone(db, card.userId, "Not/AZone");
    await recordReview(answer(card, card.wrong, T), fsrsAt(T));
    expect((await cardRow(card)).misconceptionUntil).toEqual(NEXT_IST_MIDNIGHT);
  });

  it("replays a double submit with the stored override and writes nothing (E12)", async () => {
    const card = await seedCard();
    const input = answer(card, card.wrong, T);
    const first = await recordReview(input, fsrsAt(T));
    const before = await cardRow(card);
    const again = await recordReview(input, fsrsAt(new Date(T.getTime() + 2 * SECOND)));

    expect(again).toEqual({ ...first, retrievabilityBefore: null, idempotentReplay: true });
    expect(again.misconceptionUntil).toEqual(NEXT_IST_MIDNIGHT);
    expect(await cardRow(card)).toEqual(before);
    expect((await stored(card)).log).toHaveLength(1);
  });

  it("matches the column default: a settings row without a zone has DEFAULT_TIME_ZONE", async () => {
    const card = await seedCard();
    const row = await db.revisionSettings.create({ data: { userId: card.userId } });
    expect(row.timezone).toBe(DEFAULT_TIME_ZONE);
  });

  it("keeps the production thresholds in DEFAULT_GRADING (R1.5)", () => {
    expect(DEFAULT_GRADING).toEqual({
      fastRatio: 1,
      latency: { window: 50, minSamples: 10, maxMs: 120_000 },
    });
  });
});
