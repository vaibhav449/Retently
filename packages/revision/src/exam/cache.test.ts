import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../config";
import { fsrsCard, uuidFor } from "../test/queue";
import { createForecastCache, forecastKey } from "./cache";
import type { ForecastInput } from "./forecast";

describe("createForecastCache (EM-13)", () => {
  it("returns a value until its TTL ends", () => {
    let now = 0;
    const cache = createForecastCache<string>({ ttlMs: 600_000, maxEntries: 10, now: () => now });
    cache.set("a", "forecast");
    now = 599_999;
    expect(cache.get("a")).toBe("forecast");
    now = 600_000;
    expect(cache.get("a")).toBeUndefined();
  });

  it("drops the oldest entry past maxEntries", () => {
    const cache = createForecastCache<number>({ ttlMs: 1_000, maxEntries: 2, now: () => 0 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect([cache.get("a"), cache.get("b"), cache.get("c")]).toEqual([undefined, 2, 3]);
  });
});

describe("forecastKey (ER4.5)", () => {
  const card = fsrsCard({ stability: 5, dueAt: new Date("2026-11-21T00:00:00Z") });
  const base: ForecastInput = {
    exam: {
      id: uuidFor(1),
      userId: "user_1",
      examDate: "2026-12-03",
      topicKeys: [`src:${uuidFor(2)}`],
      target: 0.9,
      createdAt: new Date("2026-11-19T00:00:00Z"),
      updatedAt: new Date("2026-11-19T00:00:00Z"),
    },
    now: new Date("2026-11-19T03:30:00Z"),
    today: "2026-11-19",
    timeZone: "Asia/Kolkata",
    items: [
      { itemId: uuidFor(3), schedulerVersion: "fsrs6-v1", state: card.state, dueAt: card.dueAt },
      { itemId: uuidFor(4), schedulerVersion: null, state: null, dueAt: null },
    ],
    registry: createDefaultRegistry(),
    slotsPerDay: 30,
    avgCostSec: 30,
    recentGrades: [3, 3, 1],
  };

  it("ignores now, so a second call in the TTL hits", () => {
    expect(forecastKey({ ...base, now: new Date("2026-11-19T09:00:00Z") })).toBe(forecastKey(base));
  });

  it.each<[string, Partial<ForecastInput>]>([
    ["the target", { exam: { ...base.exam, target: 0.95 } }],
    ["updated_at", { exam: { ...base.exam, updatedAt: new Date("2026-11-19T01:00:00Z") } }],
    ["the local date", { today: "2026-11-20" }],
    ["the slots", { slotsPerDay: 29 }],
    ["the grades", { recentGrades: [3, 3, 3] }],
    ["an item's state", { items: base.items.slice(0, 1) }],
    [
      "an item's due date",
      {
        items: [
          { ...(base.items[0] as ForecastInput["items"][number]), dueAt: new Date(0) },
          ...base.items.slice(1),
        ],
      },
    ],
  ])("changes with %s", (_what, change) => {
    expect(forecastKey({ ...base, ...change })).not.toBe(forecastKey(base));
  });
});
