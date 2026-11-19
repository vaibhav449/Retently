import { describe, expect, it } from "vitest";
import { createDefaultRegistry, DEFAULT_QUEUE, type QueueConfig } from "../config";
import { startOfNextLocalDay } from "../time";
import { candidate, fsrsCard, uuidFor } from "../test/queue";
import {
  configHash,
  type PlanInput,
  planEntrySchema,
  planFor,
  planMeta,
  planMetaSchema,
} from "./plan";

const DAY = 86_400_000;
const NOW = new Date("2026-11-18T03:30:00.000Z");
const CUTOFF = startOfNextLocalDay(NOW, "Asia/Kolkata");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe("configHash (Q9.1)", () => {
  it("is 16 hex digits, the same for an equal config whatever its key order", () => {
    const hash = configHash(DEFAULT_QUEUE);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    const reordered = Object.fromEntries(Object.entries(DEFAULT_QUEUE).reverse()) as QueueConfig;
    expect(configHash(reordered)).toBe(hash);
    expect(configHash(structuredClone(DEFAULT_QUEUE))).toBe(hash);
  });

  it("changes when any value changes", () => {
    const hash = configHash(DEFAULT_QUEUE);
    const changed: QueueConfig[] = [
      { ...DEFAULT_QUEUE, newShare: 0.3 },
      { ...DEFAULT_QUEUE, weights: { ...DEFAULT_QUEUE.weights, coverage: 0.6 } },
      { ...DEFAULT_QUEUE, costClampSec: [5, 121] },
      { ...DEFAULT_QUEUE, servedTypes: ["mcq", "cloze"] },
      { ...DEFAULT_QUEUE, rankerVersion: "ranker-v2" },
    ];
    for (const cfg of changed) expect(configHash(cfg)).not.toBe(hash);
  });
});

const ENTRY = {
  item_id: uuidFor(1),
  category: "review",
  topic_key: "src:x",
  priority: 1.5,
  features: { overdue: 1, exam: 0, mis: 0, weak: 0.5, cov: 0 },
  cost_sec: 30,
  ext: 0,
};

describe("plan JSON schemas (QD-15)", () => {
  it("accept a valid entry and meta", () => {
    expect(planEntrySchema.parse(ENTRY)).toEqual(ENTRY);
    const meta = planMeta(
      { N: 30, qNew: 8, qOld: 22, misReserve: 2, backlog: false, avgCostSec: 30 },
      DEFAULT_QUEUE,
      NOW,
    );
    expect(planMetaSchema.parse(meta)).toEqual(meta);
    expect(meta).toMatchObject({
      ranker_version: "ranker-v1",
      config_hash: configHash(DEFAULT_QUEUE),
      exam_ids: [],
      built_at: NOW.toISOString(),
      extensions: [],
    });
  });

  it("reject a missing field, a bad category or a bad id", () => {
    const missing: Partial<typeof ENTRY> = { ...ENTRY };
    delete missing.priority;
    expect(planEntrySchema.safeParse(missing).success).toBe(false);
    expect(planEntrySchema.safeParse({ ...ENTRY, category: "exam" }).success).toBe(false);
    expect(planEntrySchema.safeParse({ ...ENTRY, item_id: "not-a-uuid" }).success).toBe(false);
    expect(planEntrySchema.safeParse({ ...ENTRY, ext: -1 }).success).toBe(false);
  });
});

/** The §9.4 shape: 12 due, 2 open misconceptions, 40 unseen, 900 s at 30 s each. */
function lightDay(overrides: Partial<PlanInput> = {}): PlanInput {
  const topics = ["src:a", "src:b", "src:c"];
  const due = Array.from({ length: 12 }, (_, i) =>
    candidate(100 + i, fsrsCard({ stability: 5, dueAt: ago(1 + i / 10) }), {
      topic: topics[i % 3],
    }),
  );
  const mis = Array.from({ length: 2 }, (_, i) =>
    candidate(200 + i, fsrsCard({ stability: 20, dueAt: ago(-10), misconceptionUntil: ago(0.2) }), {
      topic: topics[i],
    }),
  );
  const fresh = Array.from({ length: 40 }, (_, i) =>
    candidate(300 + i, null, { topic: topics[i % 3] }),
  );
  return {
    old: [...due, ...mis],
    fresh,
    seen: [...due, ...mis],
    now: NOW,
    cutoff: CUTOFF,
    registry: createDefaultRegistry(),
    budgetSec: 900,
    recentTypes: Array.from({ length: 100 }, () => "mcq" as const),
    mediansMs: {},
    soloReviewCount: 500,
    ext: 0,
    ...overrides,
  };
}

describe("planFor (06 §1, QA4)", () => {
  it("builds the §9.4 light day: N 30, 14 old + 8 new = 22 entries", () => {
    const { entries, numbers } = planFor(lightDay(), DEFAULT_QUEUE);
    expect(numbers).toEqual({
      N: 30,
      qNew: 8,
      qOld: 22,
      misReserve: 2,
      backlog: false,
      avgCostSec: 30,
    });
    expect(entries).toHaveLength(22);
    const count = (category: string) =>
      entries.filter((entry) => entry.category === category).length;
    expect([count("misconception"), count("review"), count("new")]).toEqual([2, 12, 8]);
    for (const entry of entries) {
      expect(planEntrySchema.parse(entry)).toEqual(entry);
      expect(entry).toMatchObject({ cost_sec: 30, ext: 0 });
    }
    // The misconceptions (5 + weakness) lead the plan.
    expect(entries[0]?.category).toBe("misconception");
  });

  it("interleaves topics: no two neighbours share one while another is left", () => {
    const { entries } = planFor(lightDay(), DEFAULT_QUEUE);
    entries.forEach((entry, index) => {
      if (index > 0 && entry.topic_key === entries[index - 1]?.topic_key) {
        expect(entries.slice(index).every((rest) => rest.topic_key === entry.topic_key)).toBe(true);
      }
    });
  });

  it("is deterministic: the same input, in any order, gives a deep-equal plan", () => {
    const input = lightDay();
    const shuffled = lightDay({
      old: [...input.old].reverse(),
      fresh: [...input.fresh].reverse(),
      seen: [...input.seen].reverse(),
    });
    expect(planFor(shuffled, DEFAULT_QUEUE)).toEqual(planFor(input, DEFAULT_QUEUE));
  });

  it("gives a cold-start user up to N new items, and an empty plan with nothing to plan", () => {
    const cold = planFor(
      lightDay({ old: [], seen: [], soloReviewCount: 3, recentTypes: [] }),
      DEFAULT_QUEUE,
    );
    expect(cold.entries).toHaveLength(30);
    expect(cold.entries.every((entry) => entry.category === "new")).toBe(true);

    const empty = planFor(lightDay({ old: [], fresh: [], seen: [] }), DEFAULT_QUEUE);
    expect(empty.entries).toEqual([]);
    expect(empty.numbers.backlog).toBe(false);
  });

  it("an extension skips excluded items, lifts the new cap and continues the interleaving", () => {
    const first = planFor(lightDay(), DEFAULT_QUEUE);
    const inPlan = new Set(first.entries.map((entry) => entry.item_id));
    const last = first.entries.at(-1)?.topic_key ?? null;
    const extension = planFor(
      lightDay({ ext: 1, exclude: inPlan, lastTopic: last }),
      DEFAULT_QUEUE,
    );
    // 32 new items remain; N = 30 with the cap lifted.
    expect(extension.entries).toHaveLength(30);
    expect(extension.entries.some((entry) => inPlan.has(entry.item_id))).toBe(false);
    expect(extension.entries.every((entry) => entry.ext === 1)).toBe(true);
    expect(extension.entries[0]?.topic_key).not.toBe(last);
  });

  it("uses the user's medians for N: 12 s MCQs cost 22 s, so 900 s is 40 slots", () => {
    const { numbers } = planFor(lightDay({ mediansMs: { mcq: 12_000 } }), DEFAULT_QUEUE);
    expect(numbers).toMatchObject({ avgCostSec: 22, N: 40 });
  });
});
