import { examForecastSchema, renderExamHeadline } from "@repo/contracts";
import { createRegistry, fsrs6V1, placeholderV0, sm2V1 } from "@repo/scheduler";
import { describe, expect, it } from "vitest";
import { createDefaultRegistry, DEFAULT_EXAM } from "../config";
import { fsrsCard, mulberry32, uuidFor } from "../test/queue";
import { localDayStarts } from "../time";
import {
  buildForecast,
  type ForecastInput,
  histogram,
  lapseRate,
  type StoredExam,
} from "./forecast";
import { requiredCapacity, type SimItem } from "./simulate";

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

function storedExam(examDate: string, target = 0.9): StoredExam {
  return {
    id: uuidFor(999),
    userId: "user_1",
    examDate,
    topicKeys: [`src:${uuidFor(1)}`],
    target,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function input(
  opts: Partial<ForecastInput> & { examDate?: string; target?: number },
): ForecastInput {
  return {
    exam: storedExam(opts.examDate ?? "2026-12-03", opts.target),
    now: NOW,
    today: TODAY,
    timeZone: ZONE,
    items: opts.items ?? [seen(1, 3, 1), seen(2, 30, 0), unseen(3), unseen(4)],
    registry: opts.registry ?? registry,
    slotsPerDay: opts.slotsPerDay ?? 30,
    avgCostSec: opts.avgCostSec ?? 30,
    recentGrades: opts.recentGrades ?? [],
  };
}

/** The required capacity of an input, computed the same way buildForecast() does. */
function requiredOf(i: ForecastInput): number | null {
  const days = Math.round((Date.parse(i.exam.examDate) - Date.parse(i.today)) / DAY);
  return requiredCapacity(
    i.items,
    {
      now: i.now,
      dayStarts: localDayStarts(i.today, days, ZONE),
      registry: i.registry,
      grade: 3,
      middayHours: 12,
    },
    i.exam.target,
  ).capacity;
}

const forecast = (i: ForecastInput) => examForecastSchema.parse(buildForecast(i, DEFAULT_EXAM));

describe("lapse rate λ (07 §5.3)", () => {
  it("is the prior with fewer than 30 solo reviews, else the Again share of the newest 200", () => {
    expect(lapseRate([], DEFAULT_EXAM)).toBe(0.15);
    expect(lapseRate(Array<number>(29).fill(1), DEFAULT_EXAM)).toBe(0.15);
    expect(
      lapseRate([...Array<number>(6).fill(1), ...Array<number>(24).fill(3)], DEFAULT_EXAM),
    ).toBeCloseTo(0.2);
    // Only the newest 200 count: 200 Goods, then 100 Agains further back.
    expect(
      lapseRate([...Array<number>(200).fill(3), ...Array<number>(100).fill(1)], DEFAULT_EXAM),
    ).toBe(0);
  });
});

describe("histogram", () => {
  it("puts R_exam in 10 buckets, 0.9 and 1.0 in the last", () => {
    expect(histogram([0, 0.05, 0.1, 0.55, 0.899, 0.9, 1], 10)).toEqual([
      2, 1, 0, 0, 0, 1, 0, 0, 1, 2,
    ]);
  });
});

describe("status rules (07 §6, plan §4.7, EA5)", () => {
  it("exam_passed: the exam date is before today", () => {
    const f = forecast(input({ examDate: "2026-11-18" }));
    expect(f.status).toBe("exam_passed");
    expect(f.headline).toEqual({ status: "exam_passed", date: "2026-11-18" });
    expect(f.exam.days_left).toBe(-1);
    expect(f.plan.per_day).toEqual([]);
  });

  it("no_items: nothing in scope can be served", () => {
    const f = forecast(input({ items: [] }));
    expect(f.status).toBe("no_items");
    expect(f.headline).toEqual({ status: "no_items" });
    expect(f.items).toEqual({ total: 0, seen: 0, unseen: 0 });
    expect(f.if_nothing_more.histogram).toEqual(Array<number>(10).fill(0));
  });

  it("on_track: slots ≥ recommended; n is the at-target count at the current pace", () => {
    const f = forecast(input({ slotsPerDay: 30 }));
    expect(f.status).toBe("on_track");
    expect(f.plan.feasible).toBe(true);
    expect(f.plan.recommended_per_day).toBe(Math.ceil((f.plan.required_per_day ?? 0) * 1.15));
    expect(f.headline).toEqual({
      status: "on_track",
      n: f.at_current_pace.at_target,
      total: 4,
      target_pct: 90,
      date: "2026-12-03",
    });
    expect(f.at_current_pace.at_target).toBe(4);
    expect(renderExamHeadline(f.headline)).toBe(
      "On track: at your pace, 4/4 items should be at 90% on 3 December.",
    );
  });

  // Enough unseen items that the required capacity is well above 1.
  const many = Array.from({ length: 40 }, (_, i) => unseen(i + 1));
  const required = requiredOf(input({ items: many })) as number;

  it("tight: required ≤ slots < recommended", () => {
    expect(required).toBeGreaterThan(1);
    const f = forecast(input({ items: many, slotsPerDay: required }));
    expect(f.status).toBe("tight");
    expect(f.headline).toEqual({
      status: "tight",
      required,
      recommended: Math.ceil(required * 1.15),
    });
  });

  it("behind: slots < required; minutes = ⌈recommended · avg cost / 60⌉", () => {
    const f = forecast(input({ items: many, slotsPerDay: required - 1, avgCostSec: 45 }));
    expect(f.status).toBe("behind");
    const recommended = Math.ceil(required * 1.15);
    expect(f.plan.minutes_per_day).toBe(Math.ceil((recommended * 45) / 60));
    expect(f.headline).toEqual({
      status: "behind",
      slots: required - 1,
      n: f.at_current_pace.at_target,
      total: 40,
      target_pct: 90,
      minutes: f.plan.minutes_per_day,
    });
    expect(f.at_current_pace.at_target).toBeLessThan(40);
  });

  it("infeasible: even every slot leaves an item short; n is the best at-target count", () => {
    // A placeholder card recalls 0.9^days: reviewed at noon, it is at 95 % by midnight, short of 97.
    const state = placeholderV0.next(placeholderV0.initial(), 3, new Date(NOW.getTime() - 3 * DAY));
    const placeholder: SimItem = {
      itemId: uuidFor(70),
      schedulerVersion: "placeholder-v0",
      state,
      dueAt: new Date(state.due_at ?? 0),
    };
    const f = forecast(
      input({ examDate: "2026-11-20", target: 0.97, items: [placeholder, seen(2, 60, 0)] }),
    );
    expect(f.status).toBe("infeasible");
    expect(f.plan.feasible).toBe(false);
    expect(f.plan.required_per_day).toBeNull();
    // The seen FSRS item (S = 60, just reviewed) stays above 97 %; only the placeholder is studied.
    expect(f.plan.per_day).toEqual([1]);
    expect(f.plan.at_target_with_plan).toBe(1);
    expect(f.headline).toEqual({
      status: "infeasible",
      n: 1,
      total: 2,
      target_pct: 97,
      date: "2026-11-20",
    });
  });

  it("above 0.9, plans exam-due reviews too, so a high target is reachable (07 §4.2)", () => {
    // One new question, exam in 3 days, 95 %: due dates alone would leave it at 0.89.
    const f = forecast(input({ examDate: "2026-11-22", target: 0.95, items: [unseen(1)] }));
    expect(f.status).toBe("on_track");
    expect(f.plan).toMatchObject({ feasible: true, required_per_day: 1, per_day: [1, 1, 0] });
    expect(f.assumptions).toContain(
      "A question comes back as soon as its recall drops below 95%, as your daily reviews do for this exam.",
    );
    const at90 = forecast(input({ examDate: "2026-11-22", target: 0.9, items: [unseen(1)] }));
    expect(at90.assumptions.some((line) => line.includes("drops below"))).toBe(false);
  });

  it("exam today: no plan, only if-nothing-more; on_track only when everything is there", () => {
    const safe = forecast(input({ examDate: TODAY, items: [seen(1, 60, 0)] }));
    expect(safe.exam.days_left).toBe(0);
    expect(safe.status).toBe("on_track");
    expect(safe.plan).toMatchObject({ required_per_day: null, per_day: [], feasible: true });

    const short = forecast(input({ examDate: TODAY, items: [seen(1, 60, 0), unseen(2)] }));
    expect(short.status).toBe("infeasible");
    expect(short.headline).toMatchObject({ n: 1, total: 2 });
    expect(short.plan.at_target_with_plan).toBe(short.if_nothing_more.at_target);
  });

  it("exam tomorrow: one study day", () => {
    const f = forecast(input({ examDate: "2026-11-20" }));
    expect(f.exam.days_left).toBe(1);
    expect(f.plan.per_day).toHaveLength(1);
  });

  it("required 0 (everything safe, nothing new) is on track with 0 minutes", () => {
    const f = forecast(input({ items: [seen(1, 80, 0), seen(2, 60, 1)] }));
    expect(f.status).toBe("on_track");
    expect(f.plan).toMatchObject({
      required_per_day: 0,
      recommended_per_day: 0,
      minutes_per_day: 0,
    });
    expect(f.plan.per_day.every((n) => n === 0)).toBe(true);
  });
});

describe("assumptions and approximate (07 §8, EM-17)", () => {
  it("lists the fixed assumptions and the prior λ", () => {
    const f = forecast(input({}));
    expect(f.assumptions).toContain("Every review is graded Good.");
    expect(f.assumptions).toContain("No reviews on exam day.");
    expect(f.assumptions.some((line) => line.startsWith("Lapse allowance: 15%"))).toBe(true);
    expect(f.approximate).toBe(false);
    expect(f.scheduler_version).toBe("fsrs6-v1");
    expect(f.lapse_rate).toBe(0.15);
  });

  it("flags SM-2 and mixed versions, each card through its own scheduler", () => {
    const withSm2 = createRegistry([placeholderV0, fsrs6V1, sm2V1], "fsrs6-v1");
    const sm2State = sm2V1.next(sm2V1.initial(), 3, new Date(NOW.getTime() - 2 * DAY));
    const sm2Item: SimItem = {
      itemId: uuidFor(50),
      schedulerVersion: "sm2-v1",
      state: sm2State,
      dueAt: new Date(sm2State.due_at ?? 0),
    };
    const f = forecast(input({ registry: withSm2, items: [sm2Item, seen(1, 5, 1)] }));
    expect(f.approximate).toBe(true);
    expect(f.assumptions.some((line) => line.includes("SM-2"))).toBe(true);
    expect(f.assumptions.some((line) => line.includes("different scheduler versions"))).toBe(true);
  });

  it("flags placeholder cards", () => {
    const state = placeholderV0.next(placeholderV0.initial(), 3, new Date(NOW.getTime() - DAY));
    const item: SimItem = {
      itemId: uuidFor(60),
      schedulerVersion: "placeholder-v0",
      state,
      dueAt: new Date(state.due_at ?? 0),
    };
    const f = forecast(input({ items: [item] }));
    expect(f.approximate).toBe(true);
    expect(f.assumptions.some((line) => line.includes("placeholder"))).toBe(true);
  });
});

describe("a 07 §5.4-like synthetic set (shape, not a golden)", () => {
  it("100 items, 60 learned, 40 new, exam in 14 days", () => {
    const random = mulberry32(5_4);
    const items = [
      ...Array.from({ length: 60 }, (_, i) => seen(i + 1, 1 + random() * 30, random() * 20)),
      ...Array.from({ length: 40 }, (_, i) => unseen(100 + i)),
    ];
    const f = forecast(
      input({
        items,
        examDate: "2026-12-03",
        recentGrades: [...Array<number>(12).fill(1), ...Array<number>(88).fill(3)],
      }),
    );
    expect(f.lapse_rate).toBeCloseTo(0.12);
    expect(f.if_nothing_more.at_target).toBeLessThan(60);
    expect(f.if_nothing_more.histogram[0]).toBe(40);
    expect(f.plan.feasible).toBe(true);
    expect(f.plan.at_target_with_plan).toBe(100);
    expect(f.plan.per_day).toHaveLength(14);
    expect(Math.max(...f.plan.per_day)).toBe(f.plan.required_per_day);
    expect(f.plan.per_day.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(100);
    expect(f.plan.mean_r_exam_with_plan).toBeGreaterThan(f.if_nothing_more.mean_r_exam);
    expect(f.plan.recommended_per_day).toBe(Math.ceil((f.plan.required_per_day ?? 0) * 1.12));
  });
});
