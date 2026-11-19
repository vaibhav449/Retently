import { createDb, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDefaultRegistry, DEFAULT_GRADING, DEFAULT_QUEUE } from "../config";
import { ReviewError, type ReviewErrorCode } from "../errors";
import { signPresentationToken, verifyPresentationToken } from "../record/token";
import { uuidv7 } from "../record/uuidv7";
import { type SeededMcq, seedMcq, seedUser, seedUserWithMcq } from "../test/seed";
import { startOfNextLocalDay } from "../time";
import { answerReview } from "./answer";
import { presentNext } from "./present";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = createDb(inject("databaseUrl")));
});

afterAll(() => close());

const SECRET = "test-review-token-secret-at-least-32-chars";
const T0 = new Date("2026-10-22T09:00:00.000Z");
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(T0.getTime() + ms);

const present = (userId: string, now: Date) =>
  presentNext(userId, {
    db,
    clock: { now: () => now },
    registry: createDefaultRegistry(),
    grading: DEFAULT_GRADING,
    queue: DEFAULT_QUEUE,
    tokenSecret: SECRET,
  });

const answer = (userId: string, body: unknown, now: Date) =>
  answerReview(userId, body, {
    db,
    clock: { now: () => now },
    registry: createDefaultRegistry(),
    grading: DEFAULT_GRADING,
    tokenSecret: SECRET,
  });

/** Presents the next item and returns its token and option ids, failing if nothing is due. */
async function presentOk(userId: string, now: Date) {
  const next = await present(userId, now);
  if (next.state !== "ok") throw new Error(`expected an item, got ${next.state}`);
  return next;
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

describe("GET /api/review/next (presentNext)", () => {
  it("has nothing for a user with no items", async () => {
    expect(await present(await seedUser(db), T0)).toEqual({ state: "nothing_due" });
  });

  it("presents a new MCQ with a token for that presentation, and never the answer", async () => {
    const seeded = await seedUserWithMcq(db);
    const next = await presentOk(seeded.userId, T0);

    expect(next.item.category).toBe("new");
    expect(next.item.item.id).toBe(seeded.itemId);
    expect(next.item.item.options.map((option) => option.text).sort()).toEqual([
      "Golgi apparatus",
      "Mitochondrion",
      "Ribosome",
    ]);
    expect(next.progress).toEqual({ done: 0, planned: 1 });

    const verified = await verifyPresentationToken(next.item.presentation_token, SECRET, T0);
    expect(verified).toMatchObject({
      ok: true,
      presentation: { userId: seeded.userId, itemId: seeded.itemId, presentedAt: T0 },
    });

    const body = JSON.stringify(next);
    for (const leak of ["answer_option_id", '"answer"', "rubric", '"correct"']) {
      expect(body).not.toContain(leak);
    }
  });

  it("never presents items from someone else's notes", async () => {
    const owner = await seedUserWithMcq(db);
    const stranger = await seedUserWithMcq(db);
    const next = await presentOk(stranger.userId, T0);
    expect(next.item.item.id).not.toBe(owner.itemId);
  });

  it("does not present a reviewed card again until it is due, then presents it as a review", async () => {
    const seeded = await seedUserWithMcq(db);
    const first = await presentOk(seeded.userId, T0);
    await answer(
      seeded.userId,
      {
        presentation_token: first.item.presentation_token,
        confidence: "sure",
        response: { kind: "mcq", option_id: seeded.right },
        client_latency_ms: 4000,
      },
      at(5 * SECOND),
    );

    // fsrs6-v1 gives a new card answered Good 3 days (04-scheduler.md §4.2).
    expect(await present(seeded.userId, at(2 * DAY))).toEqual({ state: "nothing_due" });
    const due = await presentOk(seeded.userId, at(3 * DAY + 5 * SECOND));
    expect(due.item).toMatchObject({ category: "review", item: { id: seeded.itemId } });
  });
});

describe("POST /api/review/answer (answerReview)", () => {
  it("records a correct answer and returns the reveal", async () => {
    const seeded = await seedUserWithMcq(db);
    const next = await presentOk(seeded.userId, T0);
    const result = await answer(
      seeded.userId,
      {
        presentation_token: next.item.presentation_token,
        confidence: "sure",
        response: { kind: "mcq", option_id: seeded.right },
        client_latency_ms: 4200,
      },
      at(5 * SECOND),
    );

    expect(result).toMatchObject({
      status: "graded",
      result: {
        item_id: seeded.itemId,
        correct: true,
        correct_answer: "Mitochondrion",
        grade: 3,
        retrievability_before: null,
        next_due_at: at(3 * DAY + 5 * SECOND).toISOString(),
        scheduled_days: 3,
        idempotent_replay: false,
        citation: {
          chunk_id: seeded.chunkId,
          source_kind: "note",
          title: "Biology — Cell structure",
          block_id: "blk_7f3a",
        },
      },
    });
    expect(result.status === "graded" && result.result.misconception).toBeFalsy();
    const row = await db.reviewLog.findFirstOrThrow({ where: { userId: seeded.userId } });
    expect(row).toMatchObject({ confidence: "sure", latencyMs: 4200, correct: true });
  });

  it("turns a confident wrong answer into a misconception in the student's own words", async () => {
    const seeded = await seedUserWithMcq(db);
    const next = await presentOk(seeded.userId, T0);
    const result = await answer(
      seeded.userId,
      {
        presentation_token: next.item.presentation_token,
        confidence: "sure",
        response: { kind: "mcq", option_id: seeded.wrong },
        client_latency_ms: 3000,
      },
      at(4 * SECOND),
    );

    expect(result).toMatchObject({
      status: "graded",
      result: {
        correct: false,
        grade: 1,
        misconception: { your_answer: "Ribosome", correct_answer: "Mitochondrion" },
      },
    });
  });

  it("answers the same presentation twice with one row and a replay", async () => {
    const seeded = await seedUserWithMcq(db);
    const next = await presentOk(seeded.userId, T0);
    const body = {
      presentation_token: next.item.presentation_token,
      confidence: "think_so",
      response: { kind: "mcq", option_id: seeded.right },
      client_latency_ms: 4000,
    };
    await answer(seeded.userId, body, at(5 * SECOND));
    const again = await answer(seeded.userId, body, at(6 * SECOND));

    expect(again).toMatchObject({
      status: "graded",
      result: { idempotent_replay: true, grade: 2 },
    });
    expect(await db.reviewLog.count({ where: { userId: seeded.userId } })).toBe(1);
  });

  it("keeps the smaller of the client's and the server's latency, clamped at zero", async () => {
    const seeded = await seedUserWithMcq(db);
    const slowClaim = await presentOk(seeded.userId, T0);
    await answer(
      seeded.userId,
      {
        presentation_token: slowClaim.item.presentation_token,
        confidence: "sure",
        response: { kind: "mcq", option_id: seeded.right },
        client_latency_ms: 90_000, // claims 90 s, but the server saw 5 s
      },
      at(5 * SECOND),
    );
    const row = await db.reviewLog.findFirstOrThrow({ where: { userId: seeded.userId } });
    expect(row.latencyMs).toBe(5000);
  });

  it("refuses a bad body, a forged or expired token, and another user's token (400)", async () => {
    const seeded = await seedUserWithMcq(db);
    const someoneElse = await seedUserWithMcq(db);
    const next = await presentOk(seeded.userId, T0);
    const good = {
      presentation_token: next.item.presentation_token,
      confidence: "sure",
      response: { kind: "mcq", option_id: seeded.right },
      client_latency_ms: 4000,
    };
    const forged = await signPresentationToken(
      {
        reviewId: uuidv7(T0),
        userId: seeded.userId,
        itemId: seeded.itemId,
        sessionId: null,
        presentedAt: T0,
      },
      "a-different-secret-that-is-at-least-32-chars",
    );

    expect(await errorCode(answer(seeded.userId, { ...good, confidence: undefined }, T0))).toBe(
      "invalid_request",
    );
    expect(
      await errorCode(answer(seeded.userId, { ...good, presentation_token: forged }, T0)),
    ).toBe("invalid_token");
    expect(await errorCode(answer(seeded.userId, good, at(7 * 60 * 60 * SECOND)))).toBe(
      "invalid_token",
    );
    expect(await errorCode(answer(someoneElse.userId, good, at(5 * SECOND)))).toBe("invalid_token");
    expect(await db.reviewLog.count({ where: { userId: seeded.userId } })).toBe(0);
  });
});

// ─── VS1: the misconception override in GET /next and in the answer (R4.1, R6.1) ───

/** 21:00 IST on 18 Nov 2026, and the next IST midnight. */
const NINE_PM_IST = new Date("2026-11-18T15:30:00.000Z");
const MIDNIGHT_IST = new Date("2026-11-18T18:30:00.000Z");
const plus = (instant: Date, ms: number) => new Date(instant.getTime() + ms);

/** Presents the next item at `now` and answers it `option` with `confidence` 5 s later. */
async function presentAndAnswer(
  seeded: Pick<SeededMcq, "userId">,
  option: string,
  now: Date,
  confidence: "sure" | "think_so" | "no_idea" = "sure",
) {
  const next = await presentOk(seeded.userId, now);
  const result = await answer(
    seeded.userId,
    {
      presentation_token: next.item.presentation_token,
      confidence,
      response: { kind: "mcq", option_id: option },
      client_latency_ms: 3000,
    },
    plus(now, 5 * SECOND),
  );
  if (result.status !== "graded") throw new Error("expected a graded answer");
  return { next, result: result.result };
}

/** A card_state row for a card that was never answered: only what GET /next reads matters. */
async function seedCardState(
  userId: string,
  itemId: string,
  dueAt: Date,
  misconceptionUntil: Date | null,
) {
  await db.cardState.create({
    data: {
      userId,
      itemId,
      schedulerVersion: "fsrs6-v1",
      state: {
        kind: "fsrs",
        difficulty: 5,
        stability: 100,
        last_review_at: plus(dueAt, -100 * DAY).toISOString(),
        due_at: dueAt.toISOString(),
        reps: 5,
        lapses: 0,
        scheduled_days: 100,
      },
      dueAt,
      misconceptionUntil,
      updatedAt: plus(dueAt, -100 * DAY),
    },
  });
}

/** Today's plan is answered and nothing else can be added. */
const DONE = { state: "done_for_today", can_extend: false };

describe("GET /api/review/next with the misconception override (R4.1, DD-10, DD-11)", () => {
  it("offers a 21:00 Sure + wrong again from exactly the next local midnight, as a Retest", async () => {
    const seeded = await seedUserWithMcq(db);
    await presentAndAnswer(seeded, seeded.wrong, NINE_PM_IST);

    // Still the day it was answered: today's plan is done, and the retest is tomorrow's.
    expect(await present(seeded.userId, plus(MIDNIGHT_IST, -1))).toEqual(DONE);
    const retest = await presentOk(seeded.userId, MIDNIGHT_IST);
    expect(retest.item).toMatchObject({ category: "misconception", item: { id: seeded.itemId } });
    // A new local day, a new session: its plan is the retest alone.
    expect(retest.progress).toEqual({ done: 0, planned: 1 });
  });

  it("AC2: offers the S 100 card the next local day, though FSRS says 4 days", async () => {
    const seeded = await seedUserWithMcq(db);
    await seedCardState(seeded.userId, seeded.itemId, NINE_PM_IST, null);
    const { next } = await presentAndAnswer(seeded, seeded.wrong, NINE_PM_IST);
    expect(next.item.category).toBe("review");

    const row = await db.cardState.findUniqueOrThrow({
      where: { userId_itemId: { userId: seeded.userId, itemId: seeded.itemId } },
    });
    expect(row.dueAt.getTime() - NINE_PM_IST.getTime()).toBeGreaterThan(3 * DAY);
    expect(await present(seeded.userId, plus(MIDNIGHT_IST, -1))).toEqual(DONE);
    expect((await presentOk(seeded.userId, MIDNIGHT_IST)).item.category).toBe("misconception");
  });

  it("puts an open misconception ahead of a due card, whichever is due first (06 §4)", async () => {
    const now = plus(NINE_PM_IST, 10 * DAY);
    const farAway = plus(now, 30 * DAY);

    const overrideFirst = await seedUser(db);
    const a = await seedMcq(db, overrideFirst);
    const b = await seedMcq(db, overrideFirst);
    await seedCardState(overrideFirst, a.itemId, farAway, plus(now, -2 * HOUR));
    await seedCardState(overrideFirst, b.itemId, plus(now, -1 * HOUR), null);
    expect((await presentOk(overrideFirst, now)).item).toMatchObject({
      category: "misconception",
      item: { id: a.itemId },
    });

    const dueFirst = await seedUser(db);
    const c = await seedMcq(db, dueFirst);
    const d = await seedMcq(db, dueFirst);
    await seedCardState(dueFirst, c.itemId, farAway, plus(now, -1 * HOUR));
    await seedCardState(dueFirst, d.itemId, plus(now, -2 * HOUR), null);
    // The ranker, not the due date, decides: w3 = 5 puts the misconception first.
    expect((await presentOk(dueFirst, now)).item).toMatchObject({
      category: "misconception",
      item: { id: c.itemId },
    });
    expect((await presentOk(dueFirst, now)).progress).toEqual({ done: 0, planned: 2 });
  });

  it("calls a card with an open misconception a Retest even when due_at made it due (E5)", async () => {
    const userId = await seedUser(db);
    const { itemId } = await seedMcq(db, userId);
    const now = plus(NINE_PM_IST, 10 * DAY);
    await seedCardState(userId, itemId, plus(now, -2 * HOUR), plus(now, HOUR));
    expect((await presentOk(userId, now)).item.category).toBe("misconception");
  });

  it("breaks equal priorities by stability, then by item id (E22, Q-E7)", async () => {
    const userId = await seedUser(db);
    const ids = [(await seedMcq(db, userId)).itemId, (await seedMcq(db, userId)).itemId].sort();
    const now = plus(NINE_PM_IST, 10 * DAY);
    const due = plus(now, -HOUR);
    // Identical cards on two notes: the same features, priority and stability.
    await seedCardState(userId, ids[1] as string, due, null);
    await seedCardState(userId, ids[0] as string, due, null);
    expect((await presentOk(userId, now)).item.item.id).toBe(ids[0]);
  });

  it("never offers a passed override on a retired item or one the user can no longer read (E21)", async () => {
    const now = plus(NINE_PM_IST, 10 * DAY);
    const owner = await seedUserWithMcq(db);
    const retired = await seedUserWithMcq(db);
    await seedCardState(retired.userId, retired.itemId, plus(now, 30 * DAY), plus(now, -HOUR));
    await db.item.update({ where: { id: retired.itemId }, data: { retiredAt: now } });
    expect(await present(retired.userId, now)).toEqual({ state: "nothing_due" });

    const outsider = await seedUser(db);
    await seedCardState(outsider, owner.itemId, plus(now, 30 * DAY), plus(now, -HOUR));
    expect(await present(outsider, now)).toEqual({ state: "nothing_due" });
  });

  it("after the retest, does not offer the card again before the local day it is due", async () => {
    const seeded = await seedUserWithMcq(db);
    await presentAndAnswer(seeded, seeded.wrong, NINE_PM_IST);
    const { result } = await presentAndAnswer(seeded, seeded.right, MIDNIGHT_IST, "think_so");

    const dueAt = new Date(result.next_due_at);
    // IST has no DST: the local day of `dueAt` starts at the cutoff of the day before it.
    const dueDay = startOfNextLocalDay(plus(dueAt, -DAY), "Asia/Kolkata");
    expect(dueDay.getTime()).toBeGreaterThan(MIDNIGHT_IST.getTime());
    expect(await present(seeded.userId, plus(MIDNIGHT_IST, HOUR))).toEqual(DONE);
    expect(await present(seeded.userId, plus(dueDay, -1))).toEqual({ state: "nothing_due" });
    // "Due today" is due before the next cutoff (QD-17), so it is offered from the day's start.
    expect((await presentOk(seeded.userId, dueDay)).item.category).toBe("review");
  });
});

describe("POST /api/review/answer after a Sure + wrong (R6.1, DD-12)", () => {
  it("returns the misconception block, unchanged in shape", async () => {
    const seeded = await seedUserWithMcq(db);
    const { result } = await presentAndAnswer(seeded, seeded.wrong, NINE_PM_IST);
    expect(result.misconception).toEqual({
      your_answer: "Ribosome",
      correct_answer: "Mitochondrion",
      citation: result.citation,
    });
  });

  it("reports the next local midnight as the next review of the S 100 card: tomorrow", async () => {
    const seeded = await seedUserWithMcq(db);
    await seedCardState(seeded.userId, seeded.itemId, NINE_PM_IST, null);
    const { result } = await presentAndAnswer(seeded, seeded.wrong, NINE_PM_IST);
    expect(result).toMatchObject({
      grade: 1,
      next_due_at: MIDNIGHT_IST.toISOString(),
      scheduled_days: 1,
    });
  });

  it("returns the block and the same next review again on an idempotent replay (E12)", async () => {
    const seeded = await seedUserWithMcq(db);
    const next = await presentOk(seeded.userId, NINE_PM_IST);
    const body = {
      presentation_token: next.item.presentation_token,
      confidence: "sure",
      response: { kind: "mcq", option_id: seeded.wrong },
      client_latency_ms: 3000,
    };
    const first = await answer(seeded.userId, body, plus(NINE_PM_IST, 5 * SECOND));
    const again = await answer(seeded.userId, body, plus(NINE_PM_IST, 6 * SECOND));
    if (first.status !== "graded" || again.status !== "graded") throw new Error("not graded");

    expect(again.result.idempotent_replay).toBe(true);
    expect(again.result.misconception).toEqual(first.result.misconception);
    expect(again.result.next_due_at).toBe(MIDNIGHT_IST.toISOString());
    expect(again.result.scheduled_days).toBe(1);
  });
});
