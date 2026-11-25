import { describe, expect, it } from "vitest";
import { createDefaultRegistry, DEFAULT_QUEUE } from "../config";
import { candidate, fsrsCard, mulberry32, uuidFor } from "../test/queue";
import { type ActiveExam, examTermFor, isExamDue, ramp } from "./term";

const DAY = 86_400_000;
const NOW = new Date("2026-11-19T06:30:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const registry = createDefaultRegistry();
const CFG = DEFAULT_QUEUE.exam;

const card = (stability: number, ago: number) =>
  fsrsCard({ stability, dueAt: at(stability - ago) });

function exam(opts: {
  id?: number;
  inDays: number;
  target?: number;
  scope?: string[];
}): ActiveExam {
  const examAt = at(opts.inDays);
  return {
    id: uuidFor(opts.id ?? 900),
    examAt,
    examDate: examAt.toISOString().slice(0, 10),
    target: opts.target ?? 0.9,
    scope: new Set(opts.scope ?? ["T1"]),
  };
}

describe("ramp (07 §4.1)", () => {
  it.each([
    [30, 0.05],
    [20, 0.14],
    [14, 0.25],
    [10, 0.37],
    [5, 0.61],
    [2, 0.82],
    [1, 0.9],
  ])("%d days → %d", (days, expected) => {
    expect(ramp(days, CFG.tauDays)).toBeCloseTo(expected, 2);
  });
});

/**
 * 07 prints 3 decimals (2 for the × w2 column): a value matches when it rounds to the printed one
 * either way, so within half a unit of the last printed digit (0.3215 prints as 0.321 or 0.322).
 */
function expectPrinted(value: number | undefined, printed: number, decimals: number) {
  expect(Math.abs((value ?? Number.NaN) - printed)).toBeLessThanOrEqual(
    0.5 * 10 ** -decimals + 1e-6,
  );
}

describe("§3.4 golden: exam in 5 days (EA2)", () => {
  const fiveDays = [exam({ inDays: 5 })];
  it.each([
    ["X", card(25, 2), 0.963, 0, 0.303, 0.61],
    ["Y", card(6, 3), 0.879, 0.023, 0.31, 0.62],
    ["Z", card(3, 1), 0.846, 0.06, 0.321, 0.64],
    ["W", card(40, 10), 0.953, 0, 0.303, 0.61],
    ["Q", card(1, 25), 0.591, 0.344, 0.408, 0.82],
    ["U", null, 0, 1, 0.607, 1.21],
  ] as const)("%s", (_name, seen, recall, shortfall, term, contribution) => {
    const result = examTermFor(candidate(1, seen), fiveDays, NOW, registry, CFG);
    expect(result).not.toBeNull();
    expectPrinted(result?.rExam, recall, 3);
    expectPrinted(Math.max(0, 0.9 - (result?.rExam ?? 0)) / 0.9, shortfall, 3);
    expectPrinted(result?.term, term, 3);
    expectPrinted(DEFAULT_QUEUE.weights.exam * (result?.term ?? 0), contribution, 2);
  });
});

describe("exam_term properties (EA3)", () => {
  it("is null out of scope, on exam day and after the exam", () => {
    const item = candidate(1, card(6, 3), { topic: "T2" });
    expect(examTermFor(item, [exam({ inDays: 5 })], NOW, registry, CFG)).toBeNull();
    const inScope = candidate(1, card(6, 3));
    expect(examTermFor(inScope, [exam({ inDays: 0 })], NOW, registry, CFG)).toBeNull();
    expect(examTermFor(inScope, [exam({ inDays: -1 })], NOW, registry, CFG)).toBeNull();
    expect(examTermFor(inScope, [], NOW, registry, CFG)).toBeNull();
  });

  it("is in [0, 1] and never decreases as the exam nears; R_exam stays put (1000 cases)", () => {
    const random = mulberry32(7);
    for (let i = 0; i < 1000; i += 1) {
      const seen = random() < 0.2 ? null : card(0.2 + random() * 100, random() * 30);
      const item = candidate(1, seen);
      const exams = [exam({ inDays: 1 + random() * 60, target: 0.8 + random() * 0.17 })];
      let last = -Infinity;
      let recall: number | null = null;
      for (let step = 0; step < 10; step += 1) {
        const now = new Date(NOW.getTime() + (step / 10) * DAY * 0.999);
        const result = examTermFor(item, exams, now, registry, CFG);
        if (result === null) throw new Error("expected a term");
        expect(result.term).toBeGreaterThanOrEqual(0);
        expect(result.term).toBeLessThanOrEqual(1);
        expect(result.term).toBeGreaterThanOrEqual(last);
        recall ??= result.rExam;
        expect(result.rExam).toBe(recall);
        last = result.term;
      }
    }
  });

  it("takes the largest term over several exams; a tie goes to the earlier exam, then the smaller id", () => {
    const item = candidate(1, card(6, 3));
    const far = exam({ id: 1, inDays: 20 });
    const near = exam({ id: 2, inDays: 3 });
    expect(examTermFor(item, [far, near], NOW, registry, CFG)?.exam.id).toBe(near.id);

    const unseen = candidate(2, null);
    const a = exam({ id: 5, inDays: 4 });
    const b = { ...exam({ id: 4, inDays: 4 }) };
    expect(examTermFor(unseen, [a, b], NOW, registry, CFG)?.exam.id).toBe(b.id);
  });
});

describe("exam-due (07 §4.2)", () => {
  // Not due today: last reviewed 3 days ago with S = 10, so R(now) ≈ 0.97 > 0.9.
  const seen = card(10, 3);
  const notDue = candidate(1, seen);
  const r = registry.get(seen.schedulerVersion).retrievability(seen.state, NOW);

  it("is empty at the default target: a card not due today is above 0.9", () => {
    expect(r).toBeGreaterThan(0.9);
    expect(isExamDue(notDue, [exam({ inDays: 10, target: 0.9 })], NOW, registry)).toBe(false);
  });

  it("pulls the card in once its recall is below a higher target", () => {
    expect(r).toBeLessThan(0.97);
    expect(isExamDue(notDue, [exam({ inDays: 10, target: 0.97 })], NOW, registry)).toBe(true);
  });

  it("ignores new items, out-of-scope items and exams that have started", () => {
    expect(isExamDue(candidate(2, null), [exam({ inDays: 5, target: 0.97 })], NOW, registry)).toBe(
      false,
    );
    const other = candidate(3, card(10, 3), { topic: "T9" });
    expect(isExamDue(other, [exam({ inDays: 5, target: 0.97 })], NOW, registry)).toBe(false);
    expect(isExamDue(notDue, [exam({ inDays: 0, target: 0.97 })], NOW, registry)).toBe(false);
  });
});
