import type { ItemType } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_QUEUE } from "../config";
import { mulberry32, ranked } from "../test/queue";
import { interleave } from "./interleave";
import { rank, type Ranked } from "./rank";
import { select } from "./select";

const cfg = DEFAULT_QUEUE;
const ids = (items: readonly { itemId: string }[]) => items.map((item) => item.itemId);

/** The six vectors of 06 §9.1. */
const B = ranked({ id: 2, topic: "Thermo", features: { overdue: 5, exam: 0.6, weak: 0.3 } });
const C = ranked({ id: 3, topic: "Optics", features: { mis: 1, weak: 0.6 } });
const A = ranked({ id: 1, topic: "Thermo", features: { overdue: 0.5, exam: 0.6, weak: 0.3 } });
const E = ranked({ id: 5, topic: "Thermo", features: { exam: 0.6, weak: 0.3 } });
const F = ranked({ id: 6, topic: "Optics", features: { overdue: 0.2, weak: 0.6 } });
const D = ranked({ id: 4, topic: "Optics", features: { cov: 1 } });

describe("select — the worked examples (06 §9.2–§9.5, QA2)", () => {
  it("§9.2: N = 4 is a backlog; reserves C, fills with B A E, drops F and D; interleaves to B C A E", () => {
    const selection = select({
      old: rank([A, B, C, E, F]),
      fresh: [D],
      N: 4,
      liftNewCap: false,
      cfg,
    });
    expect(selection).toMatchObject({ qNew: 0, qOld: 4, misReserve: 1, backlog: true });
    expect(ids(selection.picked)).toEqual(ids([C, B, A, E]));
    expect(selection.picked.map((item) => item.reserved)).toEqual([true, false, false, false]);
    expect(ids(interleave(rank(selection.picked)))).toEqual(ids([B, C, A, E]));
  });

  it("§9.3: a heavy backlog gives 10 items: 3 misconceptions, 7 due, 0 new", () => {
    const topics = ["T1", "T2", "T3"];
    const due = Array.from({ length: 14 }, (_, i) =>
      ranked({ id: 100 + i, topic: topics[i % 3], features: { overdue: 0.2 * i, weak: 0.2 } }),
    );
    const mis = Array.from({ length: 3 }, (_, i) =>
      ranked({ id: 200 + i, topic: topics[i], features: { mis: 1, weak: 0.2 } }),
    );
    const fresh = Array.from({ length: 20 }, (_, i) =>
      ranked({ id: 300 + i, topic: "T4", features: { cov: 1 } }),
    );
    const selection = select({ old: rank([...due, ...mis]), fresh, N: 10, liftNewCap: false, cfg });

    expect(selection).toMatchObject({ qNew: 0, qOld: 10, misReserve: 2, backlog: true });
    expect(selection.picked).toHaveLength(10);
    // The third misconception (5.2) outranks every due item and takes the next slot.
    expect(selection.picked.filter((item) => item.features.mis === 1)).toHaveLength(3);
    expect(ids(selection.picked.filter((item) => item.features.mis === 0))).toEqual(
      ids(rank(due).slice(0, 7)),
    );
    expect(selection.picked.filter((item) => item.card === null)).toHaveLength(0);
  });

  it("§9.4: a light day gives 14 old + 8 new = 22 items, leaving 8 slots empty", () => {
    const due = Array.from({ length: 12 }, (_, i) =>
      ranked({ id: 100 + i, features: { overdue: 1 } }),
    );
    const mis = Array.from({ length: 2 }, (_, i) => ranked({ id: 200 + i, features: { mis: 1 } }));
    const fresh = rank(
      Array.from({ length: 40 }, (_, i) =>
        ranked({ id: 300 + i, features: { cov: 1, weak: i / 100 } }),
      ),
    );
    const selection = select({ old: rank([...due, ...mis]), fresh, N: 30, liftNewCap: false, cfg });

    expect(selection).toMatchObject({ qNew: 8, qOld: 22, misReserve: 2, backlog: false });
    expect(selection.picked).toHaveLength(22);
    expect(ids(selection.picked.filter((item) => item.card === null))).toEqual(
      ids(fresh.slice(0, 8)),
    );
  });

  it("§9.5: a brand-new user gets up to N new items (cold start)", () => {
    const fresh = Array.from({ length: 40 }, (_, i) => ranked({ id: i, features: { cov: 1 } }));
    expect(select({ old: [], fresh, N: 30, liftNewCap: true, cfg }).picked).toHaveLength(30);
    expect(
      select({ old: [], fresh: fresh.slice(0, 12), N: 30, liftNewCap: true, cfg }).picked,
    ).toHaveLength(12);
    // Without the lift the same user would get round(0.25 × 30) = 8.
    expect(select({ old: [], fresh, N: 30, liftNewCap: false, cfg }).picked).toHaveLength(8);
  });

  it("skips short answers once 4 are picked (Q1.4, Q-E23)", () => {
    const old = rank(
      Array.from({ length: 8 }, (_, i) =>
        ranked({ id: i, type: i < 6 ? "short_answer" : "mcq", features: { overdue: 5 - i * 0.1 } }),
      ),
    );
    const picked = select({ old, fresh: [], N: 10, liftNewCap: false, cfg }).picked;
    expect(picked.filter((item) => item.type === "short_answer")).toHaveLength(4);
    expect(picked).toHaveLength(6);
  });
});

const TYPES: ItemType[] = ["mcq", "mcq", "mcq", "mcq", "cloze", "short_answer"];
const SEED = Number(process.env.QUEUE_SEED ?? 20_261_118);
const CASES = 3_000;

/** One random selection problem; everything comes from `seed`. */
function randomCase(seed: number) {
  const random = mulberry32(seed);
  const int = (max: number) => Math.floor(random() * (max + 1));
  const topics = 1 + int(4);
  let id = 0;
  const item = (seen: boolean): Ranked => {
    const mis = seen && random() < 0.2 ? 1 : 0;
    return ranked({
      id: id++,
      seen,
      topic: `T${int(topics - 1)}`,
      type: TYPES[int(TYPES.length - 1)],
      // Coarse values, so equal priorities and the tie-breaks are exercised.
      features: seen
        ? { overdue: int(10) / 2, mis, weak: int(4) / 4 }
        : { cov: 1, weak: int(4) / 4 },
      stabilityDays: int(3),
    });
  };
  const old = rank(Array.from({ length: int(45) }, () => item(true)));
  const fresh = rank(Array.from({ length: int(45) }, () => item(false)));
  return { old, fresh, N: int(40), liftNewCap: random() < 0.3 };
}

describe(`select and interleave — ${CASES} seeded cases (QA3, seed ${SEED})`, () => {
  it("hold every selection property of 06 §11", () => {
    // Plain checks, one assertion at the end: 3 000 cases × hundreds of expect() calls is slow.
    const violations: string[] = [];
    for (let n = 0; n < CASES; n++) {
      const seed = SEED + n;
      const fail = (property: string) =>
        violations.push(`seed ${seed} (rerun with QUEUE_SEED=${seed}): ${property}`);
      const { old, fresh, N, liftNewCap } = randomCase(seed);
      const { picked, misReserve } = select({ old, fresh, N, liftNewCap, cfg });
      const pickedIds = new Set(ids(picked));
      const shortAnswers = picked.filter((item) => item.type === "short_answer").length;
      const freshPicked = picked.filter((item) => item.card === null).length;
      const saFull = shortAnswers >= cfg.shortAnswerSessionCap;
      const pickedOrCapped = (item: Ranked) =>
        pickedIds.has(item.itemId) || (item.type === "short_answer" && saFull);

      if (picked.length > N) fail(`picked ${picked.length} > N ${N}`);
      if (pickedIds.size !== picked.length) fail("an item is picked twice");
      if (shortAnswers > cfg.shortAnswerSessionCap) fail(`${shortAnswers} short answers`);
      if (!liftNewCap && freshPicked > Math.round(cfg.newShare * N)) {
        fail(`${freshPicked} new items over the cap`);
      }
      if (old.length >= N && freshPicked > 0) fail("new items despite a backlog");
      const pools = new Set(ids([...old, ...fresh]));
      if (picked.some((item) => !pools.has(item.itemId))) fail("an item from neither pool");

      // The reserve: each of the top misReserve misconceptions is in, unless it is a capped short answer.
      const misPool = old.filter((item) => item.features.mis === 1);
      if (misReserve !== Math.min(misPool.length, Math.round(cfg.misconceptionReserveShare * N))) {
        fail(`misReserve ${misReserve}`);
      }
      if (!misPool.slice(0, misReserve).every(pickedOrCapped))
        fail("a reserved misconception is out");

      // No free slot while an eligible old item is left out.
      if (picked.length < N && !old.every(pickedOrCapped))
        fail("a free slot and an old item left out");

      // Interleaving: a permutation that repeats a topic only when nothing else is left.
      const lastTopic = seed % 2 === 0 ? null : (picked[0]?.topicKey ?? null);
      const ordered = interleave(rank(picked), lastTopic);
      if (ids(ordered).sort().join() !== [...pickedIds].sort().join()) {
        fail("interleaving lost or duplicated an item");
      }
      ordered.forEach((item, index) => {
        const previous = index === 0 ? lastTopic : ordered[index - 1]?.topicKey;
        if (
          item.topicKey === previous &&
          !ordered.slice(index).every((o) => o.topicKey === previous)
        ) {
          fail(`an avoidable repeat of ${previous} at position ${index}`);
        }
      });
    }
    expect(violations.slice(0, 10)).toEqual([]);
  }, 30_000);

  it("is deterministic: the same input gives the same selection (QA4)", () => {
    const input = randomCase(SEED);
    expect(select({ ...input, cfg })).toEqual(select({ ...input, cfg }));
  });

  it("never picks an id that was in neither pool", () => {
    const { old, fresh, N, liftNewCap } = randomCase(SEED + 7);
    const all = new Set(ids([...old, ...fresh]));
    for (const item of select({ old, fresh, N, liftNewCap, cfg }).picked) {
      expect(all.has(item.itemId)).toBe(true);
    }
  });
});
