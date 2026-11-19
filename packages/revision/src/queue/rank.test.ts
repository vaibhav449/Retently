import { describe, expect, it } from "vitest";
import { DEFAULT_QUEUE } from "../config";
import { ranked, uuidFor } from "../test/queue";
import { byRank, rank, score } from "./rank";

/**
 * THE GOLDEN TEST (06-queue-ranker.md §9.1, QA1) — the Phase 3 exit criterion.
 * NEVER EDIT THIS TEST TO MAKE IT PASS. If the ranker's output changes, that is a design change
 * and goes through 11-decisions.md first (10-implementation-plan.md §5).
 */
describe("golden ranker (06 §9.1)", () => {
  // Ids in alphabetical order, so the expected order is not the id order.
  const GOLDEN = [
    { name: "A", id: 1, topic: "Thermo", overdue: 0.5, exam: 0.6, mis: 0, weak: 0.3, cov: 0 },
    { name: "B", id: 2, topic: "Thermo", overdue: 5.0, exam: 0.6, mis: 0, weak: 0.3, cov: 0 },
    { name: "C", id: 3, topic: "Optics", overdue: 0, exam: 0, mis: 1, weak: 0.6, cov: 0 },
    { name: "D", id: 4, topic: "Optics", overdue: 0, exam: 0, mis: 0, weak: 0, cov: 1 },
    { name: "E", id: 5, topic: "Thermo", overdue: 0, exam: 0.6, mis: 0, weak: 0.3, cov: 0 },
    { name: "F", id: 6, topic: "Optics", overdue: 0.2, exam: 0, mis: 0, weak: 0.6, cov: 0 },
  ];
  const EXPECTED = [
    { name: "B", priority: 6.5 },
    { name: "C", priority: 5.6 },
    { name: "A", priority: 2.0 },
    { name: "E", priority: 1.5 },
    { name: "F", priority: 0.8 },
    { name: "D", priority: 0.5 },
  ];

  it("uses the weights (1, 2, 5, 1, 0.5)", () => {
    expect(DEFAULT_QUEUE.weights).toEqual({
      overdue: 1,
      exam: 2,
      misconception: 5,
      weakness: 1,
      coverage: 0.5,
    });
  });

  it("ranks B → C → A → E → F → D with priorities 6.5, 5.6, 2.0, 1.5, 0.8, 0.5", () => {
    const items = GOLDEN.map(({ id, topic, overdue, exam, mis, weak, cov }) =>
      ranked({ id, topic, features: { overdue, exam, mis, weak, cov } }),
    );
    const names = new Map(GOLDEN.map((row) => [uuidFor(row.id), row.name]));
    const result = rank(items);

    expect(result.map((item) => names.get(item.itemId))).toEqual(EXPECTED.map((row) => row.name));
    result.forEach((item, index) => {
      expect(item.priority).toBeCloseTo(EXPECTED[index]?.priority ?? Number.NaN, 9);
    });
  });
});

describe("score (06 §4)", () => {
  it("is the weighted sum of the five features", () => {
    const w = { overdue: 1, exam: 2, misconception: 5, weakness: 1, coverage: 0.5 };
    expect(score({ overdue: 3, exam: 0.5, mis: 1, weak: 0.25, cov: 1 }, w)).toBeCloseTo(
      3 + 1 + 5 + 0.25 + 0.5,
      12,
    );
    expect(score({ overdue: 0, exam: 0, mis: 0, weak: 0, cov: 0 }, w)).toBe(0);
  });
});

describe("rank (06 §4)", () => {
  it("breaks equal priorities by stability (more fragile first), then by item id (Q-E7)", () => {
    const same = { weak: 0.4 };
    const sturdy = ranked({ id: 1, features: same, stabilityDays: 30 });
    const fragileB = ranked({ id: 3, features: same, stabilityDays: 2 });
    const fragileA = ranked({ id: 2, features: same, stabilityDays: 2 });
    expect(rank([sturdy, fragileB, fragileA]).map((item) => item.itemId)).toEqual([
      uuidFor(2),
      uuidFor(3),
      uuidFor(1),
    ]);
  });

  it("does not change its input and gives the same output for the same input (QA4)", () => {
    const items = [
      ranked({ id: 4, features: { overdue: 1 } }),
      ranked({ id: 2, features: { mis: 1 } }),
      ranked({ id: 9, features: { cov: 1 } }),
    ];
    const before = items.map((item) => item.itemId);
    const first = rank(items);
    expect(items.map((item) => item.itemId)).toEqual(before);
    expect(rank([...items].reverse())).toEqual(first);
  });

  it("orders by comparing ids as strings, not by locale", () => {
    expect(byRank(ranked({ id: 0xa }), ranked({ id: 0xb }))).toBeLessThan(0);
    expect(byRank(ranked({ id: 7 }), ranked({ id: 7 }))).toBe(0);
  });
});
