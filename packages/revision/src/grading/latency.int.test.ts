import { randomUUID } from "node:crypto";
import { createDb, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { insertReviewLog, type LogFixture, seedItem, seedUser } from "../test/seed";
import { latencyMediansFromDb, type MedianQuery } from "./latency";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = createDb(inject("databaseUrl")));
});

afterAll(() => close());

const T0 = new Date("2026-11-18T10:00:00.000Z");
const MINUTE = 60_000;
/** Small numbers keep the fixtures short; production values are in config.ts. */
const CONFIG = { window: 5, minSamples: 3, maxMs: 1_000 };

interface Fixture {
  userId: string;
  mcq: string;
  cloze: string;
}

async function seed(): Promise<Fixture> {
  const userId = await seedUser(db);
  return {
    userId,
    mcq: await seedItem(db, userId, "mcq"),
    cloze: await seedItem(db, userId, "cloze"),
  };
}

/** Solo MCQ answers with these latencies, newest first, one minute apart. */
function newestFirst(f: Fixture, latencies: number[], change: Partial<LogFixture> = {}) {
  return latencies.map((latencyMs, i) => ({
    userId: f.userId,
    itemId: f.mcq,
    reviewedAt: new Date(T0.getTime() - (i + 1) * MINUTE),
    latencyMs,
    ...change,
  }));
}

const medianFor = (f: Fixture, change: Partial<MedianQuery> = {}) =>
  latencyMediansFromDb(db, CONFIG).medianMs({
    userId: f.userId,
    itemType: "mcq",
    excludeReviewId: randomUUID(),
    now: T0,
    ...change,
  });

describe("latencyMediansFromDb (05 §4, R1.1, R1.2)", () => {
  it("has no median below minSamples, and one at exactly minSamples (E14)", async () => {
    const f = await seed();
    await insertReviewLog(db, newestFirst(f, [100, 200]));
    expect(await medianFor(f)).toBeNull();
    await insertReviewLog(
      db,
      newestFirst(f, [300]).map((row) => ({ ...row, reviewedAt: T0 })),
    );
    expect(await medianFor(f)).toBe(200);
  });

  it("drops latencies over maxMs before taking the window (DD-5, E16)", async () => {
    const f = await seed();
    // Cap first: the newest five valid ones are 100…500 → 300. Window first would give 250.
    await insertReviewLog(db, newestFirst(f, [2_000, 100, 200, 300, 400, 500, 600]));
    expect(await medianFor(f)).toBe(300);
  });

  it("counts only the newest `window` reviews", async () => {
    const f = await seed();
    // Newest five: 10…50 → 30. All seven would give 40.
    await insertReviewLog(db, newestFirst(f, [10, 20, 30, 40, 50, 1_000, 1_000]));
    expect(await medianFor(f)).toBe(30);
  });

  it("ignores duels, other item types, other users, and the review being graded", async () => {
    const f = await seed();
    const other = await seed();
    await insertReviewLog(db, newestFirst(f, [100, 200, 300]));
    await insertReviewLog(db, newestFirst(f, [1, 1, 1], { context: "duel" }));
    await insertReviewLog(db, newestFirst(f, [1, 1, 1], { itemId: f.cloze }));
    await insertReviewLog(db, newestFirst(other, [1, 1, 1]));
    const [current] = await insertReviewLog(db, [
      { userId: f.userId, itemId: f.mcq, reviewedAt: T0, latencyMs: 1 },
    ]);

    // Counting the current review would give 150.
    expect(await medianFor(f, { excludeReviewId: current })).toBe(200);
    // The cloze answers are a median of their own.
    expect(await medianFor(f, { itemType: "cloze", excludeReviewId: current })).toBe(1);
  });

  it("breaks equal reviewed_at by id, newest id first (E18)", async () => {
    const f = await seed();
    const prefix = randomUUID().slice(0, -1);
    const id = (n: number) => `${prefix}${n}`;
    await insertReviewLog(
      db,
      [900, 800, 100, 200].map((latencyMs, i) => ({
        userId: f.userId,
        itemId: f.mcq,
        reviewedAt: T0,
        latencyMs,
        id: id(i + 1),
      })),
    );
    // Window 3 by id descending: 200, 100, 800 → 200. By id ascending it would be 800.
    const cfg = { ...CONFIG, window: 3 };
    const query: MedianQuery = {
      userId: f.userId,
      itemType: "mcq",
      excludeReviewId: randomUUID(),
      now: T0,
    };
    expect(await latencyMediansFromDb(db, cfg).medianMs(query)).toBe(200);
  });

  it("takes the mean of the two middle values of an even count, and counts 0 ms (E17, E19)", async () => {
    const f = await seed();
    await insertReviewLog(db, newestFirst(f, [0, 0, 10, 20]));
    expect(await medianFor(f)).toBe(5);
  });

  it("counts wrong and unsure solo answers too (D-26)", async () => {
    const f = await seed();
    await insertReviewLog(db, [
      ...newestFirst(f, [100], { correct: false, grade: 1 }),
      ...newestFirst(f, [200], { confidence: "no_idea", grade: 2 }).map((row) => ({
        ...row,
        reviewedAt: new Date(T0.getTime() - 10 * MINUTE),
      })),
      ...newestFirst(f, [300], { confidence: "think_so", grade: 2 }).map((row) => ({
        ...row,
        reviewedAt: new Date(T0.getTime() - 20 * MINUTE),
      })),
    ]);
    expect(await medianFor(f)).toBe(200);
  });
});
