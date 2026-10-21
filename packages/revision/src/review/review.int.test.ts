import { createDb, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDefaultRegistry, DEFAULT_GRADING } from "../config";
import { ReviewError, type ReviewErrorCode } from "../errors";
import { signPresentationToken, verifyPresentationToken } from "../record/token";
import { uuidv7 } from "../record/uuidv7";
import { seedUserWithMcq } from "../test/seed";
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
const DAY = 24 * 60 * 60 * SECOND;
const at = (ms: number) => new Date(T0.getTime() + ms);

const present = (userId: string, now: Date) =>
  presentNext(userId, { db, clock: { now: () => now }, tokenSecret: SECRET });

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
    expect(await present(`user_${uuidv7(T0)}`, T0)).toEqual({ state: "nothing_due" });
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

    expect(await present(seeded.userId, at(DAY / 2))).toEqual({ state: "nothing_due" });
    const tomorrow = await presentOk(seeded.userId, at(DAY + 5 * SECOND));
    expect(tomorrow.item).toMatchObject({ category: "review", item: { id: seeded.itemId } });
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
        next_due_at: at(DAY + 5 * SECOND).toISOString(),
        scheduled_days: 1,
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
