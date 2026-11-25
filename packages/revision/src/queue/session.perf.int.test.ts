import { createDb, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDefaultRegistry, DEFAULT_GRADING, DEFAULT_QUEUE } from "../config";
import { createMigratedDatabase } from "../test/database";
import { seedCardStates, seedExam, seedMcqs, seedUser } from "../test/seed";
import { getOrCreateSession } from "./session";

/**
 * QA7 (06-queue-ranker.md §11): building a session over 10 000 card_state rows takes under
 * 150 ms "on CI hardware". The budget is asserted on CI; elsewhere (a laptop running Postgres in
 * Docker) the timings are printed and only a loose guard applies, unless QUEUE_BUILD_BUDGET_MS
 * sets one. Its own database, so 10 000 cards neither slow nor disturb the other test files.
 * Runs alone (`npm run test:perf`, a CI step of its own), not in `npm run test:integration`: on a
 * shared runner, the integration suites running beside it pushed the median past the budget.
 */
const BUDGET_MS = Number(process.env.QUEUE_BUILD_BUDGET_MS ?? (process.env.CI ? 150 : 1_000));

let db: Database;
let close: () => Promise<void>;
let drop: () => Promise<void>;

beforeAll(async () => {
  const shared = inject("databaseUrl");
  const name = `${new URL(shared).pathname.slice(1)}_perf`;
  const scratch = await createMigratedDatabase(shared, name);
  drop = scratch.drop;
  ({ db, close } = createDb(scratch.url));
}, 60_000);

afterAll(async () => {
  await close();
  await drop();
});

const NOW = new Date("2026-11-18T03:30:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const plus = (instant: Date, ms: number) => new Date(instant.getTime() + ms);

describe("performance (QA7)", () => {
  it(`builds a session over 10 000 card_state rows in under ${BUDGET_MS} ms`, async () => {
    const userId = await seedUser(db);
    const { itemIds, sourceIds } = await seedMcqs(db, userId, 10_200, { sources: 100 });
    await seedCardStates(
      db,
      userId,
      itemIds.slice(0, 10_000).map((itemId, i) => ({
        itemId,
        // A third due (some long overdue), a few open misconceptions, the rest not due.
        dueAt: i % 3 === 0 ? plus(NOW, -(i % 40) * DAY) : plus(NOW, (1 + (i % 60)) * DAY),
        stability: 1 + (i % 90),
        misconceptionUntil: i % 97 === 0 ? plus(NOW, -HOUR) : null,
      })),
    );
    const deps = {
      db,
      clock: { now: () => NOW },
      registry: createDefaultRegistry(),
      grading: DEFAULT_GRADING,
      queue: DEFAULT_QUEUE,
    };

    /** Four builds: one warm-up, then the median of three. */
    const measure = async (examIds: string[]) => {
      const timings: number[] = [];
      for (let run = 0; run < 4; run++) {
        await db.reviewSession.deleteMany({ where: { userId } });
        const started = performance.now();
        const { session } = await getOrCreateSession(userId, deps);
        timings.push(performance.now() - started);
        expect(session.plan).toHaveLength(30);
        expect(session.meta).toMatchObject({ N: 30, qNew: 0, backlog: true, misReserve: 5 });
        expect(session.meta.exam_ids).toEqual(examIds);
      }
      const median = timings.slice(1).sort((a, b) => a - b)[1] ?? Number.POSITIVE_INFINITY;
      return { timings, median };
    };

    const plain = await measure([]);
    console.info(
      `buildSession over 10 000 cards: ${plain.timings.map((t) => t.toFixed(1)).join(", ")} ms ` +
        `(median ${plain.median.toFixed(1)} ms, budget ${BUDGET_MS} ms)`,
    );
    expect(plain.median).toBeLessThan(BUDGET_MS);

    // EM-18: one exam covering half the notes, at 0.95 so the exam-due pool is computed too.
    const examId = await seedExam(db, userId, {
      examDate: "2026-11-25",
      sourceIds: sourceIds.slice(0, 50),
      target: 0.95,
      at: NOW,
    });
    const withExam = await measure([examId]);
    console.info(
      `buildSession with one exam over half the cards: ` +
        `${withExam.timings.map((t) => t.toFixed(1)).join(", ")} ms (median ` +
        `${withExam.median.toFixed(1)} ms, ${(withExam.median - plain.median).toFixed(1)} ms ` +
        `more than without)`,
    );
    expect(withExam.median).toBeLessThan(BUDGET_MS);
  }, 120_000);
});
