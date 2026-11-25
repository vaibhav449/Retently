import { type CardState, createRegistry, fsrs6V1, type Scheduler } from "@repo/scheduler";
import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../config";
import { fsrsCard, mulberry32, uuidFor } from "../test/queue";
import { localDayStarts } from "../time";
import {
  atTarget,
  requiredCapacity,
  type SimItem,
  type SimOptions,
  simulatePlan,
} from "./simulate";

const DAY = 86_400_000;
const ZONE = "Asia/Kolkata";
const TODAY = "2026-11-19";
/** 09:00 IST on the 19th. */
const NOW = new Date("2026-11-19T03:30:00.000Z");
const registry = createDefaultRegistry();

const seen = (id: number, stability: number, ago: number): SimItem => {
  const card = fsrsCard({ stability, dueAt: new Date(NOW.getTime() + (stability - ago) * DAY) });
  return {
    itemId: uuidFor(id),
    schedulerVersion: card.schedulerVersion,
    state: card.state,
    dueAt: card.dueAt,
  };
};
const unseen = (id: number): SimItem => ({
  itemId: uuidFor(id),
  schedulerVersion: null,
  state: null,
  dueAt: null,
});

const options = (days: number, capacity: number): SimOptions => ({
  now: NOW,
  dayStarts: localDayStarts(TODAY, days, ZONE),
  capacity,
  registry,
  grade: 3,
  middayHours: 12,
});

/** A random in-scope set: some learned, some due, some never reviewed. */
function randomSet(seed: number, n: number): SimItem[] {
  const random = mulberry32(seed);
  return Array.from({ length: n }, (_, i) =>
    random() < 0.35 ? unseen(i + 1) : seen(i + 1, 0.5 + random() * 30, random() * 25),
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const field of Object.values(value)) deepFreeze(field);
    Object.freeze(value);
  }
  return value;
}

describe("simulatePlan (07-exam-mode.md §5.1, EA4)", () => {
  it("is deterministic", () => {
    const items = randomSet(1, 60);
    expect(simulatePlan(items, options(14, 8))).toEqual(simulatePlan(items, options(14, 8)));
  });

  it("never mutates its inputs", () => {
    const items = deepFreeze(randomSet(2, 40));
    const before = JSON.stringify(items);
    expect(() => simulatePlan(items, options(10, 5))).not.toThrow();
    expect(JSON.stringify(items)).toBe(before);
  });

  it("with no study day left (exam today) only reads R_exam", () => {
    const items = [seen(1, 25, 0), unseen(2)];
    const dayStarts = localDayStarts(TODAY, 0, ZONE);
    const result = simulatePlan(items, { ...options(0, 10), dayStarts });
    expect(result.perDay).toEqual([]);
    expect(result.rExam[0]).toBeCloseTo(1, 1);
    expect(result.rExam[1]).toBe(0);
  });

  it("reviews due items before new ones", () => {
    const items = [unseen(1), seen(2, 2, 3)];
    const result = simulatePlan(items, options(1, 1));
    expect(result.perDay).toEqual([1]);
    expect(result.rExam[0]).toBe(0);
    expect(result.rExam[1]).toBeGreaterThan(0.9);
  });

  it("reviews the lowest recall first when not every due item fits", () => {
    // Both overdue; the second has been forgotten for much longer.
    const items = [seen(1, 5, 6), seen(2, 1, 20)];
    const result = simulatePlan(items, options(1, 1));
    const untouched = simulatePlan(items, options(1, 0));
    expect(result.rExam[0]).toBe(untouched.rExam[0]);
    expect(result.rExam[1]).toBeGreaterThan(untouched.rExam[1] as number);
  });

  it("introduces new items in their given order", () => {
    const items = [unseen(3), unseen(1), unseen(2)];
    const result = simulatePlan(items, options(1, 2));
    expect(result.rExam.map((r) => r > 0)).toEqual([true, true, false]);
  });

  it("reviews an item at most once a day, even if its scheduler would bring it straight back", () => {
    // A scheduler whose every review is due again at once.
    const eager: Scheduler = {
      ...fsrs6V1,
      version: "eager",
      next: (state: CardState, grade, now) => ({
        ...fsrs6V1.next(state, grade, now),
        due_at: now.toISOString(),
      }),
    };
    const eagerRegistry = createRegistry([eager], "eager");
    const items = [unseen(1), unseen(2), unseen(3)];
    const result = simulatePlan(items, { ...options(5, 100), registry: eagerRegistry });
    expect(result.perDay).toEqual([3, 3, 3, 3, 3]);
  });

  it("with unlimited capacity reaches at least as many items as any smaller capacity (40 sets)", () => {
    for (let seed = 10; seed < 50; seed += 1) {
      const items = randomSet(seed, 30);
      const best = atTarget(simulatePlan(items, options(12, items.length)).rExam, 0.9);
      for (const capacity of [0, 1, 3, 7, 15]) {
        const got = atTarget(simulatePlan(items, options(12, capacity)).rExam, 0.9);
        expect(got, `seed ${seed}, capacity ${capacity}`).toBeLessThanOrEqual(best);
      }
    }
  });
});

describe("requiredCapacity (07 §5.2, ER4.2, EA4)", () => {
  it("C passes and C − 1 fails, over 60 random sets (seeds 100–159)", () => {
    let feasible = 0;
    for (let seed = 100; seed < 160; seed += 1) {
      const items = randomSet(seed, 25);
      const days = 3 + (seed % 20);
      const target = 0.85 + (seed % 3) * 0.05;
      const { capacity, result } = requiredCapacity(items, options(days, 0), target);
      if (capacity === null) {
        const best = simulatePlan(items, options(days, items.length));
        expect(atTarget(best.rExam, target), `seed ${seed}`).toBeLessThan(items.length);
        continue;
      }
      feasible += 1;
      expect(result).toEqual(simulatePlan(items, options(days, capacity)));
      expect(atTarget(result.rExam, target), `seed ${seed}`).toBe(items.length);
      if (capacity > 0) {
        const less = simulatePlan(items, options(days, capacity - 1));
        expect(atTarget(less.rExam, target), `seed ${seed}`).toBeLessThan(items.length);
      }
    }
    expect(feasible).toBeGreaterThan(20);
  });

  it("is 0 when everything is safe already, and null when even every slot cannot do it", () => {
    expect(requiredCapacity([seen(1, 60, 0)], options(10, 0), 0.9).capacity).toBe(0);
    expect(requiredCapacity([], options(10, 0), 0.9).capacity).toBe(0);
    // Exam in two days at 0.97: one review leaves S ≈ 2.3, too little for 1.5 days at 97 %.
    const infeasible = requiredCapacity([unseen(1)], options(2, 0), 0.97);
    expect(infeasible.capacity).toBeNull();
    expect(infeasible.result.perDay).toEqual([1, 0]);
  });

  it("with examDueBelow, also reviews an item once its recall falls below it (07 §4.2)", () => {
    // The same exam: reviewed again on day 1, when recall is ~0.95 < 0.97, it reaches 97 %.
    const examDue = requiredCapacity([unseen(1)], { ...options(2, 0), examDueBelow: 0.97 }, 0.97);
    expect(examDue.capacity).toBe(1);
    expect(examDue.result.perDay).toEqual([1, 1]);
    // A card not due for weeks (S = 30, reviewed 10 days ago: R ≈ 0.96) is pulled in at 0.97 only.
    const card = seen(2, 30, 10);
    expect(simulatePlan([card], options(3, 5)).perDay).toEqual([0, 0, 0]);
    const pulled = simulatePlan([card], { ...options(3, 5), examDueBelow: 0.97 });
    expect(pulled.perDay[0]).toBe(1);
  });
});
