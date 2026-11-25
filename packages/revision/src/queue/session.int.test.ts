import { randomUUID } from "node:crypto";
import { createDb, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDefaultRegistry, DEFAULT_GRADING, DEFAULT_QUEUE, type QueueConfig } from "../config";
import { latencyMediansFromDb } from "../grading/latency";
import { recordReview } from "../record/recordReview";
import { uuidv7 } from "../record/uuidv7";
import { presentNext } from "../review/present";
import { userRevisionSettings } from "../settings";
import {
  insertReviewLog,
  markPending,
  seedCardStates,
  seedItem,
  seedMcq,
  seedMcqs,
  seedUser,
  seedUserWithMcq,
  setRevisionSettings,
} from "../test/seed";
import { startOfNextLocalDay } from "../time";
import { loadPools } from "./load";
import { configHash } from "./plan";
import { extendSession, getOrCreateSession, type SessionDeps, sessionView } from "./session";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = createDb(inject("databaseUrl")));
});

afterAll(() => close());

const SECRET = "test-review-token-secret-at-least-32-chars";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 09:00 IST on 18 Nov 2026; the cutoff is the next IST midnight, 18:30 UTC. */
const NOW = new Date("2026-11-18T03:30:00.000Z");
const CUTOFF = new Date("2026-11-18T18:30:00.000Z");
const plus = (instant: Date, ms: number) => new Date(instant.getTime() + ms);

const deps = (now: Date, queue: QueueConfig = DEFAULT_QUEUE): SessionDeps => ({
  db,
  clock: { now: () => now },
  registry: createDefaultRegistry(),
  grading: DEFAULT_GRADING,
  queue,
});
const session = (userId: string, now: Date, queue?: QueueConfig) =>
  getOrCreateSession(userId, deps(now, queue)).then((today) => today.session);
const present = (userId: string, now: Date) =>
  presentNext(userId, { ...deps(now), tokenSecret: SECRET });
const pools = (userId: string, now = NOW, cfg = DEFAULT_QUEUE) =>
  loadPools(
    db,
    userId,
    { now, cutoff: startOfNextLocalDay(now, "Asia/Kolkata"), timeZone: "Asia/Kolkata" },
    { medians: latencyMediansFromDb(db, DEFAULT_GRADING.latency), cfg },
  );
const ids = (rows: readonly { itemId: string }[]) => rows.map((row) => row.itemId).sort();
const planIds = (plan: readonly { item_id: string }[]) => plan.map((entry) => entry.item_id);

/** Answers `itemId` at `now`: solo Sure with the right or wrong option, or a duel answer. */
async function answer(
  userId: string,
  itemId: string,
  now: Date,
  how: { correct: boolean; context?: "solo" | "duel" } = { correct: true },
) {
  const item = await db.item.findUniqueOrThrow({
    where: { id: itemId },
    select: { answerOptionId: true, options: true },
  });
  const options = item.options as { id: string }[];
  const optionId = how.correct
    ? item.answerOptionId
    : options.find((option) => option.id !== item.answerOptionId)?.id;
  const context = how.context ?? "solo";
  return recordReview(
    {
      reviewId: uuidv7(now),
      userId,
      itemId,
      context,
      confidence: context === "duel" ? null : "sure",
      response: { kind: "mcq", option_id: optionId ?? "" },
      latencyMs: 3_000,
    },
    { db, clock: { now: () => now }, registry: createDefaultRegistry(), grading: DEFAULT_GRADING },
  );
}

describe("loadPools (06 §2, Q1.2)", () => {
  it("puts cards due before the cutoff, or with an open misconception, in the old pool (Q-E1, Q-E4)", async () => {
    const userId = await seedUser(db);
    const { itemIds } = await seedMcqs(db, userId, 5);
    const [justDue, atCutoff, openMis, misToday, late] = itemIds as [
      string,
      string,
      string,
      string,
      string,
    ];
    const far = plus(NOW, 30 * DAY);
    await seedCardStates(db, userId, [
      { itemId: justDue, dueAt: plus(CUTOFF, -1) },
      { itemId: atCutoff, dueAt: CUTOFF },
      { itemId: openMis, dueAt: far, misconceptionUntil: plus(CUTOFF, -1) },
      { itemId: misToday, dueAt: far, misconceptionUntil: CUTOFF },
      { itemId: late, dueAt: plus(NOW, -3 * DAY) },
    ]);

    const loaded = await pools(userId);
    expect(ids(loaded.old)).toEqual([justDue, openMis, late].sort());
    expect(ids(loaded.seen)).toEqual([...itemIds].sort());
    expect(loaded.fresh).toEqual([]);
  });

  it("leaves retired, unreadable, pending and non-MCQ items out of the pools", async () => {
    const userId = await seedUser(db);
    const stranger = await seedUserWithMcq(db);
    const { itemIds } = await seedMcqs(db, userId, 6);
    const [retired, pending, due, newOk, newRetired, newPending] = itemIds as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const cloze = await seedItem(db, userId, "cloze");
    const newCloze = await seedItem(db, userId, "cloze");
    const past = plus(NOW, -DAY);
    await seedCardStates(db, userId, [
      { itemId: retired, dueAt: past },
      { itemId: pending, dueAt: past },
      { itemId: due, dueAt: past },
      { itemId: cloze, dueAt: past },
      // A card on someone else's item: not readable, so not in the bank (QD-1).
      { itemId: stranger.itemId, dueAt: past },
    ]);
    await db.item.updateMany({
      where: { id: { in: [retired, newRetired] } },
      data: { retiredAt: NOW },
    });
    await markPending(db, userId, pending, NOW);
    await markPending(db, userId, newPending, NOW);

    const loaded = await pools(userId);
    expect(ids(loaded.old)).toEqual([due]);
    // Pending and cloze cards still count for topic weakness; retired and unreadable ones don't.
    expect(ids(loaded.seen)).toEqual([pending, due, cloze].sort());
    expect(ids(loaded.fresh)).toEqual([newOk]);
    expect(ids(loaded.fresh)).not.toContain(newCloze);
  });

  it("orders the new pool newest source first, then reading order, and stops at the limit", async () => {
    const userId = await seedUser(db);
    const at = (hours: number) => plus(NOW, hours * HOUR);
    async function note(createdAt: Date, chunks: { createdAt: Date; items: Date[] }[]) {
      const source = await db.source.create({
        data: { ownerId: userId, kind: "note", title: "Note", createdAt },
      });
      const created: string[] = [];
      for (const chunk of chunks) {
        const row = await db.chunk.create({
          data: {
            sourceId: source.id,
            blockIds: [],
            text: "Text.",
            contentHash: randomUUID(),
            createdAt: chunk.createdAt,
          },
        });
        for (const itemAt of chunk.items) {
          const right = randomUUID();
          const item = await db.item.create({
            data: {
              sourceChunkId: row.id,
              type: "mcq",
              prompt: "Q?",
              answer: "A",
              options: [
                { id: right, text: "A" },
                { id: randomUUID(), text: "B" },
              ],
              answerOptionId: right,
              createdAt: itemAt,
            },
          });
          created.push(item.id);
        }
      }
      return created;
    }
    const older = await note(at(-48), [{ createdAt: at(-48), items: [at(-48), at(-47)] }]);
    const newer = await note(at(-24), [
      { createdAt: at(-23), items: [at(-23)] },
      { createdAt: at(-24), items: [at(-22), at(-24)] },
    ]);
    const expected = [newer[2], newer[1], newer[0], older[0], older[1]];

    expect((await pools(userId)).fresh.map((c) => c.itemId)).toEqual(expected);
    const limited = await pools(userId, NOW, { ...DEFAULT_QUEUE, newPoolLimit: 3 });
    expect(limited.fresh.map((c) => c.itemId)).toEqual(expected.slice(0, 3));
  });

  it("reads the recent review types, the solo count and the medians; duels never count", async () => {
    const userId = await seedUser(db);
    const { itemId } = await seedMcq(db, userId);
    await insertReviewLog(db, [
      ...Array.from({ length: 12 }, (_, i) => ({
        userId,
        itemId,
        reviewedAt: plus(NOW, -(i + 1) * HOUR),
        latencyMs: 8_000,
      })),
      {
        userId,
        itemId,
        reviewedAt: plus(NOW, -MINUTE),
        latencyMs: 1_000,
        context: "duel" as const,
      },
    ]);
    const loaded = await pools(userId);
    expect(loaded.soloReviewCount).toBe(12);
    expect(loaded.recentTypes).toEqual(Array.from({ length: 12 }, () => "mcq"));
    expect(loaded.mediansMs).toEqual({ mcq: 8_000 });
  });
});

describe("userRevisionSettings (Q3.1)", () => {
  it("uses the defaults without a row, the stored values with one, and clamps the budget", async () => {
    const userId = await seedUser(db);
    expect(await userRevisionSettings(db, userId, DEFAULT_QUEUE)).toEqual({
      timeZone: "Asia/Kolkata",
      budgetSec: 900,
    });
    await setRevisionSettings(db, userId, { timezone: "UTC", dailyBudgetSec: 1_200 });
    expect(await userRevisionSettings(db, userId, DEFAULT_QUEUE)).toEqual({
      timeZone: "UTC",
      budgetSec: 1_200,
    });
    const narrow = { ...DEFAULT_QUEUE, budgetBoundsSec: [300, 1_000] as const };
    expect((await userRevisionSettings(db, userId, narrow)).budgetSec).toBe(1_000);
  });
});

describe("getOrCreateSession (06 §8, Q6.1, Q6.5)", () => {
  it("builds one row and one plan for two concurrent first calls (QA6, QD-3)", async () => {
    const userId = await seedUser(db);
    await seedMcqs(db, userId, 5);
    const [a, b] = await Promise.all([session(userId, NOW), session(userId, NOW)]);
    expect(a.id).toBe(b.id);
    expect(a.plan).toEqual(b.plan);
    expect(a.plan).toHaveLength(5);
    expect(await db.reviewSession.count({ where: { userId } })).toBe(1);
  });

  it("returns the saved plan later the same day, even after new items appear (Q-E17)", async () => {
    const userId = await seedUser(db);
    await seedMcqs(db, userId, 2);
    const first = await session(userId, NOW);
    await seedMcqs(db, userId, 2);
    const later = await session(userId, plus(NOW, 10 * HOUR));
    expect(later).toEqual(first);
  });

  it("starts a new session on the next local day: the IST date, not the UTC one (Q-E2, Q-E3)", async () => {
    const userId = await seedUser(db);
    await seedMcqs(db, userId, 2);
    const lastMs = await session(userId, plus(CUTOFF, -1));
    const midnight = await session(userId, CUTOFF);
    // 01:30 IST: the UTC date is still the 18th.
    const earlyHours = await session(userId, plus(CUTOFF, 90 * MINUTE));
    expect(lastMs.localDate).toBe("2026-11-18");
    expect(midnight.localDate).toBe("2026-11-19");
    expect(earlyHours.id).toBe(midnight.id);
    expect(midnight.id).not.toBe(lastMs.id);

    const utcUser = await seedUser(db);
    await setRevisionSettings(db, utcUser, { timezone: "UTC" });
    await seedMcqs(db, utcUser, 1);
    expect((await session(utcUser, plus(CUTOFF, 90 * MINUTE))).localDate).toBe("2026-11-18");
  });

  it("puts yesterday's misconception in today's plan, flagged, and not today's (QA6, Q-E4)", async () => {
    const seeded = await seedUserWithMcq(db);
    const ninePm = new Date("2026-11-18T15:30:00.000Z");
    await answer(seeded.userId, seeded.itemId, ninePm, { correct: false });

    // Made today: misconception_until is the cutoff itself, so nothing is left for today.
    expect((await session(seeded.userId, plus(ninePm, 30 * MINUTE))).plan).toEqual([]);

    const tomorrow = await session(seeded.userId, plus(CUTOFF, 9 * HOUR));
    expect(tomorrow.plan).toHaveLength(1);
    expect(tomorrow.plan[0]).toMatchObject({
      item_id: seeded.itemId,
      category: "misconception",
      features: { mis: 1 },
    });
    expect(tomorrow.plan[0]?.priority).toBeGreaterThanOrEqual(5);
  });

  it("gives a brand-new user a cold-start session of N new items, not six (QA8)", async () => {
    const userId = await seedUser(db);
    await seedMcqs(db, userId, 40, { sources: 8 });
    const today = await session(userId, NOW);
    expect(today.plan).toHaveLength(30);
    expect(today.plan.every((entry) => entry.category === "new")).toBe(true);
    expect(today.meta).toMatchObject({ N: 30, qNew: 30, backlog: false, avg_cost_sec: 30 });
  });

  it("keeps an empty plan only while nothing can be planned, then rebuilds it (QD-4, Q-E18)", async () => {
    const userId = await seedUser(db);
    const empty = await session(userId, NOW);
    expect(empty.plan).toEqual([]);

    await seedMcqs(db, userId, 3);
    const rebuilt = await session(userId, plus(NOW, HOUR));
    expect(rebuilt.id).toBe(empty.id);
    expect(rebuilt.plan).toHaveLength(3);
    expect(rebuilt.createdAt).toEqual(plus(NOW, HOUR));
  });

  it("stores created_at from the injected clock, the budget, and meta (QD-5, Q9.1)", async () => {
    const userId = await seedUser(db);
    await setRevisionSettings(db, userId, { dailyBudgetSec: 600 });
    await seedMcqs(db, userId, 3);
    const today = await session(userId, NOW);
    expect(today.createdAt).toEqual(NOW);
    expect(today.budgetSec).toBe(600);
    expect(today.meta).toMatchObject({
      ranker_version: "ranker-v1",
      config_hash: configHash(DEFAULT_QUEUE),
      N: 20,
      exam_ids: [],
      built_at: NOW.toISOString(),
      extensions: [],
    });
  });
});

describe("presentNext over today's session (06 §8, Q6.2, Q6.3)", () => {
  it("serves the plan in order, skipping answered entries", async () => {
    const userId = await seedUser(db);
    await seedMcqs(db, userId, 3);
    const { plan } = await session(userId, NOW);

    const first = await present(userId, NOW);
    expect(first).toMatchObject({ state: "ok", progress: { done: 0, planned: 3 } });
    if (first.state !== "ok") throw new Error("expected an item");
    expect(first.item.item.id).toBe(plan[0]?.item_id);

    await answer(userId, first.item.item.id, plus(NOW, MINUTE));
    const second = await present(userId, plus(NOW, 2 * MINUTE));
    expect(second).toMatchObject({ state: "ok", progress: { done: 1, planned: 3 } });
    if (second.state !== "ok") throw new Error("expected an item");
    expect(second.item.item.id).toBe(plan[1]?.item_id);
  });

  it("skips entries retired, pending or made unreadable after the plan was built (Q-E14, Q-E15)", async () => {
    const userId = await seedUser(db);
    const stranger = await seedUser(db);
    await seedMcqs(db, userId, 4);
    const [retired, pending, unreadable, last] = planIds((await session(userId, NOW)).plan);

    await db.item.update({ where: { id: retired ?? "" }, data: { retiredAt: NOW } });
    await markPending(db, userId, pending ?? "", NOW);
    const chunk = await db.item.findUniqueOrThrow({
      where: { id: unreadable ?? "" },
      select: { sourceChunk: { select: { sourceId: true } } },
    });
    await db.source.update({
      where: { id: chunk.sourceChunk.sourceId },
      data: { ownerId: stranger },
    });

    const next = await present(userId, plus(NOW, MINUTE));
    expect(next).toMatchObject({ state: "ok", progress: { done: 0, planned: 1 } });
    if (next.state !== "ok") throw new Error("expected an item");
    expect(next.item.item.id).toBe(last);
  });

  it("skips an entry answered in a duel that is no longer due (Q-E13)", async () => {
    const userId = await seedUser(db);
    const { itemIds } = await seedMcqs(db, userId, 2);
    await seedCardStates(
      db,
      userId,
      itemIds.map((itemId) => ({ itemId, dueAt: plus(NOW, -DAY) })),
    );
    const [duelled, other] = planIds((await session(userId, NOW)).plan);
    await answer(userId, duelled ?? "", plus(NOW, MINUTE), { correct: true, context: "duel" });

    const next = await present(userId, plus(NOW, 2 * MINUTE));
    expect(next).toMatchObject({ state: "ok", progress: { done: 0, planned: 1 } });
    if (next.state !== "ok") throw new Error("expected an item");
    expect(next.item.item.id).toBe(other);
  });

  it("is done for today once every entry is answered, and can extend when candidates appear", async () => {
    const userId = await seedUser(db);
    const { itemIds } = await seedMcqs(db, userId, 2);
    await session(userId, NOW);
    await answer(userId, itemIds[0] ?? "", plus(NOW, MINUTE));
    await answer(userId, itemIds[1] ?? "", plus(NOW, MINUTE));

    expect(await present(userId, plus(NOW, 2 * MINUTE))).toEqual({
      state: "done_for_today",
      can_extend: false,
    });
    await seedMcqs(db, userId, 1);
    expect(await present(userId, plus(NOW, 3 * MINUTE))).toEqual({
      state: "done_for_today",
      can_extend: true,
    });
  });

  it("has nothing_due with nothing to plan (QA8)", async () => {
    const userId = await seedUser(db);
    expect(await present(userId, NOW)).toEqual({ state: "nothing_due" });
  });

  it("signs the token with the session id", async () => {
    const userId = await seedUser(db);
    await seedMcqs(db, userId, 1);
    const today = await session(userId, NOW);
    const next = await present(userId, NOW);
    if (next.state !== "ok") throw new Error("expected an item");
    const payload = JSON.parse(
      Buffer.from(next.item.presentation_token.split(".")[1] ?? "", "base64url").toString(),
    ) as { sid: string };
    expect(payload.sid).toBe(today.id);
  });
});

describe("sessionView (Q6.1, §4.6)", () => {
  it("counts done and open entries, the remaining cost and the composition", async () => {
    const userId = await seedUser(db);
    const { itemIds } = await seedMcqs(db, userId, 4);
    await seedCardStates(db, userId, [
      { itemId: itemIds[0] ?? "", dueAt: plus(NOW, -DAY) },
      {
        itemId: itemIds[1] ?? "",
        dueAt: plus(NOW, 30 * DAY),
        misconceptionUntil: plus(NOW, -HOUR),
      },
    ]);
    const view = (now: Date) => sessionView(userId, deps(now));

    const before = await view(NOW);
    expect(before).toMatchObject({
      local_date: "2026-11-18",
      budget_sec: 900,
      remaining_sec: 120,
      planned: 4,
      done: 0,
      composition: { review: 1, misconception: 1, new: 2 },
      exam_ids: [],
    });

    await answer(userId, itemIds[2] ?? "", plus(NOW, MINUTE));
    await db.item.update({ where: { id: itemIds[3] ?? "" }, data: { retiredAt: NOW } });
    expect(await view(plus(NOW, 2 * MINUTE))).toMatchObject({
      session_id: before.session_id,
      remaining_sec: 60,
      planned: 3,
      done: 1,
      composition: { review: 1, misconception: 1, new: 1 },
    });
  });
});

describe("extendSession (06 §8, Q6.4, QD-12)", () => {
  /** A user with `due` cards due yesterday and a 300 s budget: N = 10. */
  async function backlogUser(due: number) {
    const userId = await seedUser(db);
    await setRevisionSettings(db, userId, { dailyBudgetSec: 300 });
    const { itemIds } = await seedMcqs(db, userId, due, { sources: 5 });
    await seedCardStates(
      db,
      userId,
      itemIds.map((itemId, i) => ({ itemId, dueAt: plus(NOW, -DAY - i * MINUTE) })),
    );
    return userId;
  }

  it("adds up to N more items, never one already in the plan, until none are left (QA6)", async () => {
    const userId = await backlogUser(25);
    const first = await session(userId, NOW);
    expect(first.plan).toHaveLength(10);
    expect(first.meta.backlog).toBe(true);

    await extendSession(userId, deps(plus(NOW, HOUR)));
    await extendSession(userId, deps(plus(NOW, 2 * HOUR)));
    const view = await extendSession(userId, deps(plus(NOW, 3 * HOUR)));

    const after = await session(userId, plus(NOW, 3 * HOUR));
    expect(after.plan).toHaveLength(25);
    expect(new Set(planIds(after.plan)).size).toBe(25);
    expect(after.plan.slice(0, 10)).toEqual(first.plan);
    expect(after.plan.map((entry) => entry.ext)).toEqual([
      ...Array.from({ length: 10 }, () => 0),
      ...Array.from({ length: 10 }, () => 1),
      ...Array.from({ length: 5 }, () => 2),
    ]);
    // The third call had nothing to add: unchanged.
    expect(after.extendedCount).toBe(2);
    expect(after.meta.extensions.map((ext) => ext.added)).toEqual([10, 5]);
    expect(view.planned).toBe(25);
    expect(await present(userId, plus(NOW, 4 * HOUR))).toMatchObject({ state: "ok" });
  });

  it("never adds an item twice under two concurrent extends (Q-E19)", async () => {
    const userId = await backlogUser(25);
    await session(userId, NOW);
    await Promise.all([
      extendSession(userId, deps(plus(NOW, HOUR))),
      extendSession(userId, deps(plus(NOW, HOUR))),
    ]);
    const after = await session(userId, plus(NOW, HOUR));
    expect(after.plan).toHaveLength(25);
    expect(new Set(planIds(after.plan)).size).toBe(25);
    expect(after.extendedCount).toBe(2);
  });

  it("uses the budget as it is now, while the session keeps its own (Q-E20)", async () => {
    const userId = await backlogUser(40);
    await session(userId, NOW);
    await setRevisionSettings(db, userId, { dailyBudgetSec: 600 });
    const view = await extendSession(userId, deps(plus(NOW, HOUR)));
    expect(view.planned).toBe(30);
    expect(view.budget_sec).toBe(300);
  });

  it("lifts the new-item cap: 8 new items in the plan, then 30 more", async () => {
    const userId = await seedUser(db);
    // 25 solo reviews of a retired item: past the cold start, and nothing to plan from them.
    const history = (await seedMcq(db, userId)).itemId;
    await db.item.update({ where: { id: history }, data: { retiredAt: NOW } });
    await insertReviewLog(
      db,
      Array.from({ length: 25 }, (_, i) => ({
        userId,
        itemId: history,
        reviewedAt: plus(NOW, -(i + 1) * DAY),
        latencyMs: 20_000,
      })),
    );
    await seedMcqs(db, userId, 50, { sources: 5 });

    const first = await session(userId, NOW);
    expect(first.meta).toMatchObject({ N: 30, qNew: 8 });
    expect(first.plan).toHaveLength(8);

    const view = await extendSession(userId, deps(plus(NOW, HOUR)));
    expect(view.planned).toBe(38);
    expect(view.composition.new).toBe(38);
  });

  it("leaves the session unchanged when there is nothing to add", async () => {
    const userId = await seedUser(db);
    await seedMcqs(db, userId, 2);
    const before = await session(userId, NOW);
    await extendSession(userId, deps(plus(NOW, HOUR)));
    expect(await session(userId, plus(NOW, HOUR))).toEqual(before);
  });
});
