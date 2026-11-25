import { createDb, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDefaultRegistry, DEFAULT_EXAM, DEFAULT_GRADING, DEFAULT_QUEUE } from "../config";
import { createExam, deleteExam, type ExamDeps } from "../exam/exams";
import { recordReview } from "../record/recordReview";
import { uuidv7 } from "../record/uuidv7";
import { presentNext } from "../review/present";
import { seedCardStates, seedExam, seedMcqs, seedUser } from "../test/seed";
import {
  extendSession,
  getOrCreateSession,
  nextInSession,
  type SessionDeps,
  sessionView,
} from "./session";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = createDb(inject("databaseUrl")));
});

afterAll(() => close());

const SECRET = "test-review-token-secret-at-least-32-chars";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 09:00 IST on 19 Nov 2026. */
const NOW = new Date("2026-11-19T03:30:00.000Z");
const plus = (instant: Date, ms: number) => new Date(instant.getTime() + ms);

const deps = (now: Date): SessionDeps => ({
  db,
  clock: { now: () => now },
  registry: createDefaultRegistry(),
  grading: DEFAULT_GRADING,
  queue: DEFAULT_QUEUE,
});
const examDeps = (now: Date): ExamDeps => ({
  db,
  clock: { now: () => now },
  exam: DEFAULT_EXAM,
  queue: DEFAULT_QUEUE,
});
const session = (userId: string, now: Date) =>
  getOrCreateSession(userId, deps(now)).then((today) => today.session);

/** Answers `itemId` correctly with Sure at `now`. */
async function answer(userId: string, itemId: string, now: Date) {
  const item = await db.item.findUniqueOrThrow({
    where: { id: itemId },
    select: { answerOptionId: true },
  });
  return recordReview(
    {
      reviewId: uuidv7(now),
      userId,
      itemId,
      context: "solo",
      confidence: "sure",
      response: { kind: "mcq", option_id: item.answerOptionId ?? "" },
      latencyMs: 3_000,
    },
    { db, clock: { now: () => now }, registry: createDefaultRegistry(), grading: DEFAULT_GRADING },
  );
}

/**
 * A user with two notes, A and B, of two MCQs each (round-robin: items 0 and 2 on A), every card
 * due since yesterday.
 */
async function twoNotes() {
  const userId = await seedUser(db);
  const { itemIds, sourceIds } = await seedMcqs(db, userId, 4, { sources: 2 });
  await seedCardStates(
    db,
    userId,
    itemIds.map((itemId) => ({ itemId, dueAt: plus(NOW, -DAY), stability: 4 })),
  );
  const [a, b] = sourceIds as [string, string];
  return {
    userId,
    itemIds,
    onA: [itemIds[0], itemIds[2]] as string[],
    keyA: `src:${a}`,
    keyB: `src:${b}`,
  };
}

describe("exams in the daily session (ER3.2–ER3.6, EA6)", () => {
  it("an exam created today changes tomorrow's persisted plan, not today's (D-47, E12)", async () => {
    const { userId, onA, keyA } = await twoNotes();
    const today = await session(userId, NOW);
    expect(today.meta.exam_ids).toEqual([]);
    expect(today.plan.every((entry) => entry.features.exam === 0)).toBe(true);

    const exam = await createExam(
      userId,
      { exam_date: "2026-11-26", topic_keys: [keyA] },
      examDeps(plus(NOW, HOUR)),
    );
    const sameDay = await session(userId, plus(NOW, 2 * HOUR));
    expect(sameDay.plan).toEqual(today.plan);

    const tomorrow = await session(userId, plus(NOW, DAY));
    expect(tomorrow.meta.exam_ids).toEqual([exam.id]);
    for (const entry of tomorrow.plan) {
      if (onA.includes(entry.item_id)) {
        expect(entry.features.exam).toBeGreaterThan(0.25);
        expect(entry.exam_ref).toMatchObject({ exam_id: exam.id, exam_date: "2026-11-26" });
      } else {
        expect(entry.features.exam).toBe(0);
        expect(entry.exam_ref).toBeUndefined();
      }
    }
    // A days-and-recall why line for an in-scope question (EM-11).
    const shown = await presentNext(userId, { ...deps(plus(NOW, DAY)), tokenSecret: SECRET });
    expect(shown.state).toBe("ok");
    if (shown.state === "ok" && onA.includes(shown.item.item.id)) {
      expect(shown.reason).toMatchObject({ kind: "exam" });
      expect(shown.reason?.message).toMatch(/^Your exam is in 6 days and your predicted recall/);
    }
    expect(shown.state === "ok" && shown.reason !== undefined).toBe(true);
  });

  it("gives an exam no boost on its own day (EM-7)", async () => {
    const { userId, keyA } = await twoNotes();
    await seedExam(db, userId, { examDate: "2026-11-19", topicKeys: [keyA] });
    const today = await session(userId, NOW);
    expect(today.meta.exam_ids).toEqual([]);
    expect(today.plan.every((entry) => entry.features.exam === 0)).toBe(true);
  });

  /** One card on a note, not due today: S = 10, reviewed 5 days ago, so R(now) ≈ 0.94. */
  async function notDueCard() {
    const userId = await seedUser(db);
    const { itemIds, sourceIds } = await seedMcqs(db, userId, 1, { sources: 1 });
    const itemId = itemIds[0] as string;
    await seedCardStates(db, userId, [{ itemId, stability: 10, dueAt: plus(NOW, 5 * DAY) }]);
    return { userId, itemId, key: `src:${sourceIds[0]}` };
  }

  it("plans an exam-due card only when the target is above 0.9 (EA6, E15)", async () => {
    const at90 = await notDueCard();
    await seedExam(db, at90.userId, { examDate: "2026-11-29", topicKeys: [at90.key], target: 0.9 });
    expect((await session(at90.userId, NOW)).plan).toEqual([]);

    const at95 = await notDueCard();
    await seedExam(db, at95.userId, {
      examDate: "2026-11-29",
      topicKeys: [at95.key],
      target: 0.95,
    });
    const plan = (await session(at95.userId, NOW)).plan;
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ item_id: at95.itemId, category: "review", exam_due: true });

    // Not due today, yet open (EM-10): served, counted, and done once answered.
    const shown = await presentNext(at95.userId, { ...deps(plus(NOW, HOUR)), tokenSecret: SECRET });
    expect(shown.state === "ok" && shown.item.item.id).toBe(at95.itemId);
    expect(await sessionView(at95.userId, deps(plus(NOW, HOUR)))).toMatchObject({
      planned: 1,
      done: 0,
    });
    await answer(at95.userId, at95.itemId, plus(NOW, 2 * HOUR));
    expect(await sessionView(at95.userId, deps(plus(NOW, 3 * HOUR)))).toMatchObject({
      planned: 1,
      done: 1,
    });
  });

  it("drops a retired item and a deleted note's items from the next plan (EA6, E8, E9)", async () => {
    const { userId, itemIds, keyA, keyB } = await twoNotes();
    await seedExam(db, userId, { examDate: "2026-11-30", topicKeys: [keyA, keyB] });
    await db.item.update({ where: { id: itemIds[0] }, data: { retiredAt: NOW } });
    await db.source.delete({ where: { id: keyB.slice(4) } });
    const plan = (await session(userId, NOW)).plan.map((entry) => entry.item_id);
    expect(plan).toEqual([itemIds[2]]);
  });

  it("'study more' uses an exam created mid-day and unions meta.exam_ids (ER3.5, E12)", async () => {
    const { userId, itemId, key } = await notDueCard();
    // Something due, so the morning plan is not empty.
    const { itemIds } = await seedMcqs(db, userId, 1, { sources: 1 });
    const dueId = itemIds[0] as string;
    await seedCardStates(db, userId, [{ itemId: dueId, dueAt: plus(NOW, -DAY), stability: 4 }]);

    const morning = await session(userId, NOW);
    expect(morning.plan.map((entry) => entry.item_id)).toEqual([dueId]);
    await answer(userId, dueId, plus(NOW, HOUR));
    expect(await nextInSession(userId, deps(plus(NOW, HOUR)))).toEqual({
      kind: "done",
      canExtend: false,
    });

    const exam = await createExam(
      userId,
      { exam_date: "2026-11-29", topic_keys: [key], target_retention: 0.95 },
      examDeps(plus(NOW, 2 * HOUR)),
    );
    expect(await nextInSession(userId, deps(plus(NOW, 2 * HOUR)))).toEqual({
      kind: "done",
      canExtend: true,
    });
    await extendSession(userId, deps(plus(NOW, 3 * HOUR)));
    const extended = await session(userId, plus(NOW, 3 * HOUR));
    expect(extended.plan.map((entry) => entry.item_id)).toEqual([dueId, itemId]);
    expect(extended.plan[1]).toMatchObject({ exam_due: true, ext: 1 });
    expect(extended.meta.exam_ids).toEqual([exam.id]);
    expect(extended.meta.extensions[0]?.exam_ids).toEqual([exam.id]);

    // Deleting the exam leaves today's entries as planned (E13).
    await deleteExam(userId, exam.id, examDeps(plus(NOW, 4 * HOUR)));
    expect(await sessionView(userId, deps(plus(NOW, 4 * HOUR)))).toMatchObject({
      planned: 2,
      done: 1,
      exam_ids: [exam.id],
    });
  });
});
