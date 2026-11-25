import type { ExamForecast } from "@repo/contracts";
import { createDb, type Database } from "@repo/db";
import { createRegistry, fsrs6V1, placeholderV0, sm2V1 } from "@repo/scheduler";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDefaultRegistry, DEFAULT_EXAM, DEFAULT_GRADING, DEFAULT_QUEUE } from "../config";
import { latencyMediansFromDb } from "../grading/latency";
import { insertReviewLog, seedCardStates, seedExam, seedMcqs, seedUser } from "../test/seed";
import { createForecastCache } from "./cache";
import { forecastFor } from "./forecast-io";
import type { ForecastDeps } from "./load";
import { ExamError } from "./validate";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = createDb(inject("databaseUrl")));
});

afterAll(() => close());

const DAY = 86_400_000;
/** 09:00 IST on 19 Nov 2026. */
const NOW = new Date("2026-11-19T03:30:00.000Z");
const plus = (days: number) => new Date(NOW.getTime() + days * DAY);

const deps = (now = NOW, registry = createDefaultRegistry()): ForecastDeps => ({
  db,
  clock: { now: () => now },
  registry,
  queue: DEFAULT_QUEUE,
  exam: DEFAULT_EXAM,
  medians: latencyMediansFromDb(db, DEFAULT_GRADING.latency),
});

/** A user with two notes of 3 MCQs each; the first note's items are seen, the second's new. */
async function scenario() {
  const userId = await seedUser(db);
  const { itemIds, sourceIds } = await seedMcqs(db, userId, 6, { sources: 2 });
  // Round-robin: items 0, 2, 4 are on note 0.
  const onFirst = [itemIds[0], itemIds[2], itemIds[4]] as string[];
  await seedCardStates(
    db,
    userId,
    onFirst.map((itemId, i) => ({ itemId, stability: 5 + i * 10, dueAt: plus(2 + i) })),
  );
  const examId = await seedExam(db, userId, { examDate: "2026-12-03", sourceIds, at: NOW });
  return { userId, itemIds, sourceIds, examId, onFirst };
}

describe("forecastFor (ER4, EA6)", () => {
  it("forecasts the exam's servable items: 3 seen, 3 new, exam in 14 days", async () => {
    const { userId, examId } = await scenario();
    const forecast = await forecastFor(userId, examId, deps());
    expect(forecast.items).toEqual({ total: 6, seen: 3, unseen: 3 });
    expect(forecast.exam).toMatchObject({ id: examId, days_left: 14, target_retention: 0.9 });
    expect(forecast.plan.per_day).toHaveLength(14);
    expect(forecast.plan.feasible).toBe(true);
    // 900 s at the 30 s prior: 30 slots, far more than 6 items need.
    expect(forecast.at_current_pace.slots_per_day).toBe(30);
    expect(forecast.status).toBe("on_track");
    expect(forecast.if_nothing_more.histogram[0]).toBe(3);
    expect(forecast.computed_at).toBe(NOW.toISOString());
  });

  it("drops a retired item and a deleted note's items on the next call (E8, E9)", async () => {
    const { userId, examId, itemIds, sourceIds } = await scenario();
    await db.item.update({ where: { id: itemIds[0] }, data: { retiredAt: NOW } });
    expect((await forecastFor(userId, examId, deps())).items.total).toBe(5);
    await db.source.delete({ where: { id: sourceIds[1] } });
    expect((await forecastFor(userId, examId, deps())).items).toEqual({
      total: 2,
      seen: 2,
      unseen: 0,
    });
    await db.source.delete({ where: { id: sourceIds[0] } });
    const empty = await forecastFor(userId, examId, deps());
    expect(empty.status).toBe("no_items");
  });

  it("counts an item added to a scope note later as unseen (E10)", async () => {
    const { userId, examId, sourceIds } = await scenario();
    const chunk = await db.chunk.findFirstOrThrow({ where: { sourceId: sourceIds[0] } });
    await db.item.create({
      data: {
        sourceChunkId: chunk.id,
        type: "mcq",
        prompt: "Later?",
        answer: "Yes",
        options: [
          { id: "11111111-1111-4111-8111-111111111111", text: "Yes" },
          { id: "22222222-2222-4222-8222-222222222222", text: "No" },
        ],
        answerOptionId: "11111111-1111-4111-8111-111111111111",
      },
    });
    expect((await forecastFor(userId, examId, deps())).items.unseen).toBe(4);
  });

  it("is not_found for another user's exam (EA6, E22)", async () => {
    const { examId } = await scenario();
    const stranger = await seedUser(db);
    await expect(forecastFor(stranger, examId, deps())).rejects.toBeInstanceOf(ExamError);
    await expect(forecastFor(stranger, "x", deps())).rejects.toMatchObject({ code: "not_found" });
  });

  it("shows a past exam as exam_passed (E3)", async () => {
    const { userId, sourceIds } = await scenario();
    const past = await seedExam(db, userId, { examDate: "2026-11-02", sourceIds });
    const forecast = await forecastFor(userId, past, deps());
    expect(forecast.status).toBe("exam_passed");
    expect(forecast.headline).toEqual({ status: "exam_passed", date: "2026-11-02" });
  });

  it("uses the user's own lapse rate after 30 solo reviews (ER4.2)", async () => {
    const { userId, examId, onFirst } = await scenario();
    await insertReviewLog(
      db,
      Array.from({ length: 40 }, (_, i) => ({
        userId,
        itemId: onFirst[i % 3] as string,
        reviewedAt: new Date(NOW.getTime() - (i + 1) * 3_600_000),
        latencyMs: 5_000,
        grade: i < 10 ? 1 : 3,
        correct: i >= 10,
      })),
    );
    const forecast = await forecastFor(userId, examId, deps());
    expect(forecast.lapse_rate).toBeCloseTo(0.25);
  });

  it("runs SM-2 cards through SM-2 and flags the forecast approximate (E18, EM-17)", async () => {
    const userId = await seedUser(db);
    const { itemIds, sourceIds } = await seedMcqs(db, userId, 2, { sources: 1 });
    const state = sm2V1.next(sm2V1.initial(), 3, plus(-2));
    await db.cardState.create({
      data: {
        userId,
        itemId: itemIds[0] as string,
        schedulerVersion: "sm2-v1",
        state: { ...state },
        dueAt: new Date(state.due_at ?? 0),
        updatedAt: plus(-2),
      },
    });
    const examId = await seedExam(db, userId, { examDate: "2026-12-03", sourceIds });
    const withSm2 = createRegistry([placeholderV0, fsrs6V1, sm2V1], "fsrs6-v1");
    const forecast = await forecastFor(userId, examId, deps(NOW, withSm2));
    expect(forecast.approximate).toBe(true);
    expect(forecast.assumptions.some((line) => line.includes("SM-2"))).toBe(true);
    expect(forecast.items).toEqual({ total: 2, seen: 1, unseen: 1 });
  });

  it("reuses a forecast for 10 minutes; editing the target misses (ER4.5, E11)", async () => {
    const { userId, examId } = await scenario();
    let clockMs = NOW.getTime();
    const cache = createForecastCache<ExamForecast>({
      ttlMs: DEFAULT_EXAM.cacheTtlMs,
      maxEntries: 10,
      now: () => clockMs,
    });
    const first = await forecastFor(userId, examId, { ...deps(), cache });
    clockMs += 5 * 60_000;
    const second = await forecastFor(userId, examId, { ...deps(new Date(clockMs)), cache });
    expect(second).toBe(first);
    expect(second.computed_at).toBe(NOW.toISOString());

    await db.exam.update({
      where: { id: examId },
      data: { targetRetention: 0.95, updatedAt: new Date(clockMs) },
    });
    const edited = await forecastFor(userId, examId, { ...deps(new Date(clockMs)), cache });
    expect(edited).not.toBe(first);
    expect(edited.exam.target_retention).toBe(0.95);

    clockMs += 11 * 60_000;
    const expired = await forecastFor(userId, examId, { ...deps(new Date(clockMs)), cache });
    expect(expired).not.toBe(edited);
  });
});
