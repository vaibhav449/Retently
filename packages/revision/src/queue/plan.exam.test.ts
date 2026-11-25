import { describe, expect, it } from "vitest";
import { createDefaultRegistry, DEFAULT_QUEUE } from "../config";
import type { ActiveExam } from "../exam/term";
import { candidate, fsrsCard, uuidFor } from "../test/queue";
import { reasonFor } from "./explain";
import type { Candidate } from "./features";
import { examDuePool, planEntrySchema, planFor, type PlanInput } from "./plan";

const DAY = 86_400_000;
/** 09:00 IST on 19 Nov 2026; the cutoff is the next IST midnight. */
const NOW = new Date("2026-11-19T03:30:00.000Z");
const CUTOFF = new Date("2026-11-19T18:30:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const registry = createDefaultRegistry();

function exam(opts: { id?: number; inDays: number; target?: number; scope: string[] }): ActiveExam {
  const examAt = at(opts.inDays);
  return {
    id: uuidFor(opts.id ?? 900),
    examAt,
    examDate: new Date(examAt.getTime() + 6 * 3_600_000).toISOString().slice(0, 10),
    target: opts.target ?? 0.9,
    scope: new Set(opts.scope),
  };
}

function input(parts: Partial<PlanInput>): PlanInput {
  return {
    old: [],
    fresh: [],
    seen: [],
    now: NOW,
    cutoff: CUTOFF,
    registry,
    budgetSec: 900,
    recentTypes: [],
    mediansMs: {},
    // Not a cold start, so the 25 % new-item cap applies.
    soloReviewCount: 100,
    ext: 0,
    ...parts,
  };
}

/** Due a day ago, S = 5. */
const due = (id: number, topic: string) =>
  candidate(id, fsrsCard({ stability: 5, dueAt: at(-1) }), { topic });
/** Reviewed 3 days ago with S = 10: not due today, R(now) ≈ 0.95. */
const notDue = (id: number, topic: string) =>
  candidate(id, fsrsCard({ stability: 10, dueAt: at(7) }), { topic });

describe("planFor with exams (07 §4, ER3.2–ER3.5)", () => {
  it("gives in-scope items their exam term, records the exam on the entry and in the numbers", () => {
    const old = [due(1, "A"), due(2, "B")];
    const exams = [exam({ inDays: 5, scope: ["A"] })];
    const { entries, numbers } = planFor(input({ old, seen: old, exams }), DEFAULT_QUEUE);
    const byId = new Map(entries.map((entry) => [entry.item_id, entry]));
    const inScope = byId.get(uuidFor(1));
    expect(inScope?.features.exam).toBeGreaterThan(0.3);
    expect(inScope?.exam_ref).toMatchObject({ exam_id: uuidFor(900) });
    expect(inScope?.exam_ref?.r_exam).toBeGreaterThan(0);
    expect(byId.get(uuidFor(2))?.features.exam).toBe(0);
    expect(byId.get(uuidFor(2))?.exam_ref).toBeUndefined();
    expect(numbers.examIds).toEqual([uuidFor(900)]);
    for (const entry of entries) expect(planEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("without exams the plan is exactly the ranker's: no exam fields at all", () => {
    const old = [due(1, "A"), due(2, "B")];
    const { entries, numbers } = planFor(input({ old, seen: old }), DEFAULT_QUEUE);
    expect(numbers.examIds).toEqual([]);
    for (const entry of entries) {
      expect(entry.features.exam).toBe(0);
      expect("exam_ref" in entry || "exam_due" in entry).toBe(false);
    }
  });

  it("takes new exam material before other new items, a month out included, under the cap", () => {
    // Out-of-scope new items of a weak topic outrank an exam 30 days away on priority alone:
    // weakness 0.9 vs exam 2 × ramp(30) ≈ 0.1.
    const weakTopic = [due(50, "W")];
    const fresh: Candidate[] = [
      candidate(10, null, { topic: "W" }),
      candidate(11, null, { topic: "W" }),
      candidate(12, null, { topic: "A" }),
    ];
    const seen = weakTopic.map((c) => ({
      ...c,
      card: fsrsCard({ stability: 0.5, dueAt: at(-20) }),
    }));
    // N = 30 slots, 25 % new = 8; the old pool fills 29, so one new slot is left.
    const old = Array.from({ length: 29 }, (_, i) => due(100 + i, `T${i}`));
    const exams = [exam({ inDays: 30, scope: ["A"] })];
    const { entries } = planFor(input({ old, fresh, seen, exams }), DEFAULT_QUEUE);
    const fresh_ = entries.filter((entry) => entry.category === "new").map((e) => e.item_id);
    expect(fresh_).toEqual([uuidFor(12)]);

    const without = planFor(input({ old, fresh, seen }), DEFAULT_QUEUE).entries;
    expect(without.filter((e) => e.category === "new").map((e) => e.item_id)).not.toContain(
      uuidFor(12),
    );
  });

  it("adds exam-due cards only above the 0.9 target, marked exam_due (EA6, E15)", () => {
    const pool = [notDue(1, "A"), notDue(2, "B")];
    const at90 = [exam({ inDays: 10, target: 0.9, scope: ["A", "B"] })];
    expect(examDuePool({ notDue: pool, exams: at90, now: NOW, registry })).toEqual([]);
    expect(
      planFor(input({ notDue: pool, seen: pool, exams: at90 }), DEFAULT_QUEUE).entries,
    ).toEqual([]);

    const at97 = [exam({ inDays: 10, target: 0.97, scope: ["A"] })];
    const { entries } = planFor(input({ notDue: pool, seen: pool, exams: at97 }), DEFAULT_QUEUE);
    expect(entries.map((entry) => entry.item_id)).toEqual([uuidFor(1)]);
    expect(entries[0]).toMatchObject({ category: "review", exam_due: true });
  });

  it("never plans an exam-due card twice when it is also due (E16)", () => {
    const card = due(1, "A");
    const exams = [exam({ inDays: 10, target: 0.97, scope: ["A"] })];
    const { entries } = planFor(
      input({ old: [card], notDue: [card], seen: [card], exams }),
      DEFAULT_QUEUE,
    );
    expect(entries.map((entry) => entry.item_id)).toEqual([uuidFor(1)]);
  });

  it("is deterministic with exams", () => {
    const old = [due(1, "A"), due(2, "B"), due(3, "A")];
    const fresh = [candidate(4, null, { topic: "A" }), candidate(5, null, { topic: "C" })];
    const exams = [exam({ inDays: 4, scope: ["A"] }), exam({ id: 901, inDays: 9, scope: ["C"] })];
    const make = () => planFor(input({ old, fresh, seen: old, exams }), DEFAULT_QUEUE);
    expect(make()).toEqual(make());
  });
});

describe("the exam why line (EM-11, ER3.6)", () => {
  const weights = DEFAULT_QUEUE.weights;
  const features = { overdue: 0.1, exam: 0.6, mis: 0, weak: 0.2, cov: 0 };

  it("names the days and the predicted recall for a seen item", () => {
    expect(
      reasonFor({ category: "review", features }, { weights, examDays: 5, rExam: 0.7412 }),
    ).toEqual({
      kind: "exam",
      message: "Your exam is in 5 days and your predicted recall here is 74%.",
    });
    expect(
      reasonFor({ category: "review", features }, { weights, examDays: 1, rExam: 0.8 }).message,
    ).toBe("Your exam is tomorrow and your predicted recall here is 80%.");
  });

  it("calls a never-reviewed item new material", () => {
    const fresh = { ...features, cov: 1 };
    expect(
      reasonFor({ category: "new", features: fresh }, { weights, examDays: 12, rExam: 0 }).message,
    ).toBe("New material for your exam in 12 days.");
  });

  it("is used only when the exam term contributes the most", () => {
    const overdue = { ...features, overdue: 3 };
    expect(
      reasonFor({ category: "review", features: overdue }, { weights, examDays: 5, rExam: 0.7 })
        .kind,
    ).toBe("overdue");
  });
});
