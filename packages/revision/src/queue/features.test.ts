import {
  createRegistry,
  fsrs6V1,
  placeholderV0,
  type PlaceholderCardState,
  type Sm2CardState,
  sm2V1,
} from "@repo/scheduler";
import { describe, expect, it } from "vitest";
import { DEFAULT_QUEUE } from "../config";
import { startOfNextLocalDay } from "../time";
import { candidate, fsrsCard } from "../test/queue";
import {
  extractFeatures,
  type FeatureContext,
  isDueToday,
  isOpenMisconception,
  type SeenCard,
  topicWeakness,
} from "./features";

const DAY = 86_400_000;
// 09:00 IST on 18 Nov 2026; the next IST midnight is 18:30 UTC the same day.
const NOW = new Date("2026-11-18T03:30:00.000Z");
const CUTOFF = startOfNextLocalDay(NOW, "Asia/Kolkata");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const registry = createRegistry([placeholderV0, fsrs6V1, sm2V1], "fsrs6-v1");

function ctx(weakness: Record<string, number> = {}): FeatureContext {
  return {
    now: NOW,
    cutoff: CUTOFF,
    registry,
    weaknessByTopic: new Map(Object.entries(weakness)),
    overdueCap: DEFAULT_QUEUE.overdueCap,
    stabilityFloorDays: DEFAULT_QUEUE.stabilityFloorDays,
  };
}

const overdueOf = (card: SeenCard) => extractFeatures(candidate(1, card), ctx()).overdue;

describe("overdue_pressure (06 §3.1)", () => {
  it("is 0 for a card that is not late yet, and for a new item", () => {
    expect(overdueOf(fsrsCard({ stability: 2, dueAt: new Date(NOW.getTime() + 1) }))).toBe(0);
    expect(overdueOf(fsrsCard({ stability: 2, dueAt: NOW }))).toBe(0);
    expect(extractFeatures(candidate(1, null), ctx()).overdue).toBe(0);
  });

  it("is days late over stability: S 2 four days late is 2.0, S 60 is about 0.07", () => {
    expect(overdueOf(fsrsCard({ stability: 2, dueAt: ago(4) }))).toBeCloseTo(2, 12);
    expect(overdueOf(fsrsCard({ stability: 60, dueAt: ago(4) }))).toBeCloseTo(4 / 60, 12);
  });

  it("divides by at least 0.1 days of stability", () => {
    expect(overdueOf(fsrsCard({ stability: 0.01, dueAt: ago(0.05) }))).toBeCloseTo(0.5, 12);
  });

  it("is capped at 10 (Q-E5, D-16)", () => {
    expect(overdueOf(fsrsCard({ stability: 0.2, dueAt: ago(3) }))).toBe(10);
    expect(overdueOf(fsrsCard({ stability: 0.2, dueAt: ago(1.9) }))).toBeCloseTo(9.5, 9);
  });

  it("reads stability through each card's own scheduler (Q-E22)", () => {
    const placeholder: PlaceholderCardState = {
      kind: "placeholder",
      last_review_at: ago(3).toISOString(),
      due_at: ago(2).toISOString(),
      reps: 1,
      lapses: 0,
    };
    const sm2: Sm2CardState = {
      kind: "sm2",
      last_review_at: ago(11).toISOString(),
      due_at: ago(6).toISOString(),
      reps: 2,
      lapses: 0,
      repetition: 2,
      interval: 5,
      ease: 2.5,
    };
    const card = (schedulerVersion: string, state: SeenCard["state"]): SeenCard => ({
      schedulerVersion,
      state,
      dueAt: new Date(state.due_at ?? 0),
      misconceptionUntil: null,
    });
    // placeholder-v0 reports 1 day of stability; SM-2 its interval.
    expect(overdueOf(card("placeholder-v0", placeholder))).toBeCloseTo(2, 12);
    expect(overdueOf(card("sm2-v1", sm2))).toBeCloseTo(6 / 5, 12);
  });
});

describe("misconception_flag and due today (06 §2, §3.3)", () => {
  const due = fsrsCard({ stability: 10, dueAt: new Date(NOW.getTime() + 30 * DAY) });
  const withUntil = (until: Date | null): SeenCard => ({ ...due, misconceptionUntil: until });

  it("is 1 only when misconception_until is before the cutoff", () => {
    const flag = (until: Date | null) => extractFeatures(candidate(1, withUntil(until)), ctx()).mis;
    expect(flag(new Date(CUTOFF.getTime() - 1))).toBe(1);
    expect(flag(ago(2))).toBe(1);
    // Made today: until = the cutoff itself, so not today's (Q-E4).
    expect(flag(CUTOFF)).toBe(0);
    expect(flag(null)).toBe(0);
    expect(isOpenMisconception(null, CUTOFF)).toBe(false);
  });

  it("counts a card due exactly at the cutoff as not due today, 1 ms earlier as due (Q-E1)", () => {
    expect(isDueToday(fsrsCard({ stability: 3, dueAt: CUTOFF }), CUTOFF)).toBe(false);
    expect(
      isDueToday(fsrsCard({ stability: 3, dueAt: new Date(CUTOFF.getTime() - 1) }), CUTOFF),
    ).toBe(true);
    // Due later today, still before the cutoff (QD-17).
    expect(
      isDueToday(
        fsrsCard({ stability: 3, dueAt: new Date(NOW.getTime() + 6 * 3_600_000) }),
        CUTOFF,
      ),
    ).toBe(true);
    expect(isDueToday(withUntil(new Date(CUTOFF.getTime() - 1)), CUTOFF)).toBe(true);
    expect(isDueToday(withUntil(CUTOFF), CUTOFF)).toBe(false);
  });
});

describe("coverage_debt and the exam term", () => {
  it("is 1 for a new item and 0 for a seen one; the exam term is 0 for now (Q1.3)", () => {
    expect(extractFeatures(candidate(1, null), ctx())).toMatchObject({ cov: 1, exam: 0, mis: 0 });
    expect(
      extractFeatures(candidate(1, fsrsCard({ stability: 1, dueAt: NOW })), ctx()),
    ).toMatchObject({ cov: 0, exam: 0 });
  });
});

describe("topic_weakness (06 §3.4)", () => {
  it("is 1 − the mean retrievability of the topic's seen cards", () => {
    // At its due date an FSRS card's recall is 0.9 by definition of S.
    const atDue = fsrsCard({ stability: 5, dueAt: NOW });
    const fresh = fsrsCard({ stability: 5, dueAt: new Date(NOW.getTime() + 5 * DAY) });
    const weakness = topicWeakness(
      [
        candidate(1, atDue, { topic: "single" }),
        candidate(2, atDue, { topic: "mixed" }),
        candidate(3, fresh, { topic: "mixed" }),
      ],
      NOW,
      registry,
    );
    expect(weakness.get("single")).toBeCloseTo(0.1, 9);
    const recentRecall = fsrs6V1.retrievability(fresh.state, NOW);
    expect(recentRecall).toBeCloseTo(1, 9);
    expect(weakness.get("mixed")).toBeCloseTo(1 - (0.9 + recentRecall) / 2, 9);
  });

  it("is 0 for a topic without seen cards (Q-E6), and every item inherits its topic's value", () => {
    const weakness = topicWeakness([candidate(1, null, { topic: "T" })], NOW, registry);
    expect(weakness.size).toBe(0);
    expect(extractFeatures(candidate(2, null, { topic: "T" }), ctx()).weak).toBe(0);
    expect(extractFeatures(candidate(2, null, { topic: "T" }), ctx({ T: 0.4 })).weak).toBe(0.4);
  });
});
