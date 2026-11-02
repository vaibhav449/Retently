import { createDb, type Database } from "@repo/db";
import { createRegistry, fsrs6V1, type Grade, placeholderV0, replay } from "@repo/scheduler";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDefaultRegistry } from "../config";
import { type RecordReviewDeps, recordReview } from "../record/recordReview";
import { uuidv7 } from "../record/uuidv7";
import { type SeededMcq, seedUserWithMcq } from "../test/seed";
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
  return { db, clock: { now: () => now }, registry, grading: { fastRatio: 1 } };
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

type Answer = "sure-right" | "sure-wrong" | "unsure-right" | "duel-right";

async function answer(
  card: SeededMcq,
  kind: Answer,
  now: Date,
  registry = createDefaultRegistry(),
) {
  const duel = kind === "duel-right";
  await recordReview(
    {
      reviewId: uuidv7(now),
      userId: card.userId,
      itemId: card.itemId,
      context: duel ? "duel" : "solo",
      confidence: duel ? null : kind === "unsure-right" ? "think_so" : "sure",
      response: { kind: "mcq", option_id: kind === "sure-wrong" ? card.wrong : card.right },
      latencyMs: 4000,
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
