import type { Confidence } from "@repo/contracts";
import { createDb, type Database } from "@repo/db";
import { createRegistry, fsrs6V1, type Grade, placeholderV0, replay } from "@repo/scheduler";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDefaultRegistry, DEFAULT_GRADING } from "../config";
import { type RecordReviewDeps, recordReview } from "../record/recordReview";
import { uuidv7 } from "../record/uuidv7";
import { type SeededMcq, seedUserWithMcq, setTimeZone } from "../test/seed";
import { startOfNextLocalDay } from "../time";
import { checkCardState, rebuildCardState } from "./replay";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = createDb(inject("databaseUrl")));
});

afterAll(() => close());

const T0 = new Date("2026-10-21T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(T0.getTime() + days * DAY);

const placeholderOnly = () => createRegistry([placeholderV0], "placeholder-v0");

function depsAt(now: Date, registry = createDefaultRegistry()): RecordReviewDeps {
  return { db, clock: { now: () => now }, registry, grading: DEFAULT_GRADING };
}

/** Seeded and deterministic (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Answer =
  "sure-right" | "sure-wrong" | "unsure-right" | "no_idea-wrong" | "duel-right" | "duel-wrong";

const ANSWER_SIGNALS: Record<Answer, { duel: boolean; confidence: Confidence; right: boolean }> = {
  "sure-right": { duel: false, confidence: "sure", right: true },
  "sure-wrong": { duel: false, confidence: "sure", right: false },
  "unsure-right": { duel: false, confidence: "think_so", right: true },
  "no_idea-wrong": { duel: false, confidence: "no_idea", right: false },
  "duel-right": { duel: true, confidence: "sure", right: true },
  "duel-wrong": { duel: true, confidence: "sure", right: false },
};

async function answer(
  card: SeededMcq,
  kind: Answer,
  now: Date,
  registry = createDefaultRegistry(),
  latencyMs = 4000,
) {
  const { duel, confidence, right } = ANSWER_SIGNALS[kind];
  return recordReview(
    {
      reviewId: uuidv7(now),
      userId: card.userId,
      itemId: card.itemId,
      context: duel ? "duel" : "solo",
      confidence: duel ? null : confidence,
      response: { kind: "mcq", option_id: right ? card.right : card.wrong },
      latencyMs,
    },
    depsAt(now, registry),
  );
}

const cardOf = (card: SeededMcq) =>
  db.cardState.findUniqueOrThrow({
    where: { userId_itemId: { userId: card.userId, itemId: card.itemId } },
  });

describe("rebuildCardState", () => {
  let card: SeededMcq;

  it("moves a placeholder card to fsrs6-v1 with the state its log replays to, duels included", async () => {
    card = await seedUserWithMcq(db);
    const history: [Answer, number, Grade][] = [
      ["sure-right", 0, 3],
      ["sure-wrong", 1, 1],
      ["duel-right", 2, 2],
      ["sure-right", 4, 3],
    ];
    for (const [kind, day] of history) await answer(card, kind, at(day), placeholderOnly());
    expect((await cardOf(card)).schedulerVersion).toBe("placeholder-v0");

    const summary = await rebuildCardState(card.userId, { db, registry: createDefaultRegistry() });

    expect(summary).toEqual({ cards: 1, changed: 1 });
    const expected = replay(
      fsrs6V1,
      history.map(([, day, grade]) => ({ grade, reviewedAt: at(day) })),
    );
    expect(await cardOf(card)).toMatchObject({
      schedulerVersion: "fsrs6-v1",
      state: expected,
      dueAt: new Date(expected.due_at ?? ""),
      misconceptionUntil: null,
      updatedAt: at(4),
    });
  });

  it("changes nothing when it runs again", async () => {
    const before = await cardOf(card);
    expect(await rebuildCardState(card.userId, { db, registry: createDefaultRegistry() })).toEqual({
      cards: 1,
      changed: 0,
    });
    expect(await cardOf(card)).toEqual(before);
  });

  it("leaves the card for recordReview to advance with FSRS afterwards", async () => {
    await answer(card, "sure-right", at(30));
    expect(await cardOf(card)).toMatchObject({
      schedulerVersion: "fsrs6-v1",
      state: { kind: "fsrs", reps: 5, lapses: 1 },
    });
    const mismatches = await checkCardState({ db, registry: createDefaultRegistry() });
    expect(mismatches.filter((m) => m.userId === card.userId)).toEqual([]);
  });
});

describe("checkCardState (invariant I2)", () => {
  it("finds card_state equal to the replay of its log after random histories", async () => {
    const next = random(1021);
    const ours = new Set<string>();
    for (let c = 0; c < 12; c++) {
      const seeded = await seedUserWithMcq(db);
      ours.add(seeded.userId);
      let day = 0;
      const answers = 1 + Math.floor(next() * 8);
      for (let i = 0; i < answers; i++) {
        const kinds: Answer[] = ["sure-right", "sure-wrong", "unsure-right", "duel-right"];
        await answer(seeded, kinds[Math.floor(next() * kinds.length)] ?? "sure-right", at(day));
        day += 1 + Math.floor(next() * 20);
      }
    }

    const mismatches = await checkCardState({ db, registry: createDefaultRegistry() });
    expect(mismatches.filter((m) => ours.has(m.userId))).toEqual([]);
  });

  it("reports a card whose state was edited by hand, and a rebuild repairs it", async () => {
    const seeded = await seedUserWithMcq(db);
    await answer(seeded, "sure-right", at(0));
    await answer(seeded, "sure-right", at(3));
    const row = await cardOf(seeded);
    await db.cardState.update({
      where: { userId_itemId: { userId: seeded.userId, itemId: seeded.itemId } },
      data: { state: { ...(row.state as object), stability: 999 } },
    });

    const registry = createDefaultRegistry();
    const found = (await checkCardState({ db, registry })).filter(
      (m) => m.userId === seeded.userId,
    );
    expect(found).toEqual([
      {
        userId: seeded.userId,
        itemId: seeded.itemId,
        problem: "state differs from the replay with fsrs6-v1",
      },
    ]);

    expect(await rebuildCardState(seeded.userId, { db, registry })).toEqual({
      cards: 1,
      changed: 1,
    });
    const after = await checkCardState({ db, registry });
    expect(after.filter((m) => m.userId === seeded.userId)).toEqual([]);
  });
});

describe("rebuild and check derive misconception_until (invariant I4, AC6)", () => {
  const SEED = 20261118;
  const MINUTE = 60 * 1000;
  const ZONES = [null, "UTC", "America/New_York", "America/Santiago", "Asia/Kathmandu"];
  // Weighted towards confident answers, so histories reach Easy and end in misconceptions.
  const KINDS: Answer[] = [
    "sure-right",
    "sure-right",
    "sure-right",
    "sure-wrong",
    "sure-wrong",
    "unsure-right",
    "no_idea-wrong",
    "duel-right",
    "duel-wrong",
  ];

  it(`gives rebuild == live for random histories across zones (seed ${SEED})`, async () => {
    const next = random(SEED);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
    const randomMinute = () => Math.floor(next() * 24 * 60) * MINUTE;

    const cards: { card: SeededMcq; zone: string; lastAt: Date; endsWrong: boolean }[] = [];
    let easy = 0;
    for (let c = 0; c < 15; c++) {
      const card = await seedUserWithMcq(db);
      const zone = ZONES[c % ZONES.length] ?? null;
      if (zone) await setTimeZone(db, card.userId, zone);

      const answers = 12 + Math.floor(next() * 9);
      const endsWrong = c % 3 === 0; // a third of the histories end with Sure + wrong
      // Random minutes of the day, so reviews land on both sides of the IST/UTC date line.
      let when = T0.getTime() + randomMinute();
      let lastAt = T0;
      for (let i = 0; i < answers; i++) {
        const kind = i === answers - 1 && endsWrong ? "sure-wrong" : pick(KINDS);
        const latencyMs = next() < 0.1 ? 200_000 : 2_000 + Math.floor(next() * 28_000);
        lastAt = new Date(when);
        const outcome = await answer(card, kind, lastAt, createDefaultRegistry(), latencyMs);
        if (outcome.grade === 4) easy++;
        when += (1 + Math.floor(next() * 20)) * DAY + randomMinute();
      }
      cards.push({ card, zone: zone ?? "Asia/Kolkata", lastAt, endsWrong });
    }

    const ours = new Set(cards.map(({ card }) => card.userId));
    const registry = createDefaultRegistry();
    const live = await Promise.all(cards.map(({ card }) => cardOf(card)));

    // (a) The check finds every live row consistent, I4 included.
    const mismatches = await checkCardState({ db, registry });
    expect(
      mismatches.filter((m) => ours.has(m.userId)),
      `seed ${SEED}`,
    ).toEqual([]);

    // (b) A rebuild changes nothing: rebuild == live.
    for (const { card } of cards) {
      expect(await rebuildCardState(card.userId, { db, registry }), `seed ${SEED}`).toEqual({
        cards: 1,
        changed: 0,
      });
    }
    expect(await Promise.all(cards.map(({ card }) => cardOf(card)))).toEqual(live);

    // (c) The generator exercised both paths, and the overrides are the next local midnights.
    expect(easy, `seed ${SEED}: no Easy grade was produced`).toBeGreaterThan(0);
    for (const [i, { zone, lastAt, endsWrong }] of cards.entries()) {
      if (endsWrong) {
        expect(live[i]?.misconceptionUntil).toEqual(startOfNextLocalDay(lastAt, zone));
      }
    }
  });

  it("reports a hand-edited misconception_until, and a rebuild repairs it", async () => {
    const registry = createDefaultRegistry();
    const cleared = await seedUserWithMcq(db);
    await answer(cleared, "sure-right", at(0));
    await answer(cleared, "sure-wrong", at(3));
    const expected = startOfNextLocalDay(at(3), "Asia/Kolkata");
    expect((await cardOf(cleared)).misconceptionUntil).toEqual(expected);

    const invented = await seedUserWithMcq(db);
    await answer(invented, "sure-right", at(0));

    const where = (card: SeededMcq) => ({
      userId_itemId: { userId: card.userId, itemId: card.itemId },
    });
    await db.cardState.update({ where: where(cleared), data: { misconceptionUntil: null } });
    await db.cardState.update({ where: where(invented), data: { misconceptionUntil: at(1) } });

    const ours = new Set([cleared.userId, invented.userId]);
    const found = (await checkCardState({ db, registry })).filter((m) => ours.has(m.userId));
    expect(found.map((m) => m.problem)).toEqual([
      "misconception_until differs from the latest review",
      "misconception_until differs from the latest review",
    ]);

    for (const card of [cleared, invented]) {
      expect(await rebuildCardState(card.userId, { db, registry })).toEqual({
        cards: 1,
        changed: 1,
      });
    }
    expect((await cardOf(cleared)).misconceptionUntil).toEqual(expected);
    expect((await cardOf(invented)).misconceptionUntil).toBeNull();
    const after = await checkCardState({ db, registry });
    expect(after.filter((m) => ours.has(m.userId))).toEqual([]);
  });

  it("derives it in the user's zone at rebuild time (DD-9, E9)", async () => {
    const registry = createDefaultRegistry();
    const card = await seedUserWithMcq(db);
    await answer(card, "sure-wrong", at(0)); // no settings row: IST
    await setTimeZone(db, card.userId, "UTC");

    const found = (await checkCardState({ db, registry })).filter((m) => m.userId === card.userId);
    expect(found.map((m) => m.problem)).toEqual([
      "misconception_until differs from the latest review",
    ]);
    await rebuildCardState(card.userId, { db, registry });
    expect((await cardOf(card)).misconceptionUntil).toEqual(startOfNextLocalDay(at(0), "UTC"));
  });
});
