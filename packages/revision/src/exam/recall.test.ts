import { fsrs6Recall, fsrs6V1, type FsrsCardState, intervalModifier } from "@repo/scheduler";
import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../config";
import { fsrsCard, mulberry32 } from "../test/queue";
import { requiredStability, rExam, shortfallNorm } from "./recall";

const DAY = 86_400_000;
const NOW = new Date("2026-11-19T06:30:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const registry = createDefaultRegistry();

/** An fsrs6-v1 card with stability S, last reviewed `ago` days before NOW. */
const card = (stability: number, ago: number) =>
  fsrsCard({ stability, dueAt: at(stability - ago) });

describe("closed form (07-exam-mode.md §2, EA1)", () => {
  const SEED = 20261119;
  const CASES = 3000;
  const TOLERANCE = 1e-9;

  it(`R(t, S) ≥ T ⟺ S ≥ t / m(T), ${CASES} seeded cases (seed ${SEED})`, () => {
    const random = mulberry32(SEED);
    let checked = 0;
    for (let i = 0; i < CASES; i += 1) {
      const stability = 0.1 + random() * 400;
      const elapsed = random() * 365;
      const target = 0.8 + random() * 0.17;
      const recall = fsrs6Recall(elapsed, stability);
      // Within the tolerance of the boundary, either side is right.
      if (Math.abs(recall - target) <= TOLERANCE) continue;
      checked += 1;
      expect(recall >= target, `S=${stability} t=${elapsed} T=${target}`).toBe(
        stability >= elapsed / intervalModifier(target),
      );
    }
    expect(checked).toBeGreaterThan(CASES * 0.99);
  });

  it("at T = 0.9 the rule is S ≥ t", () => {
    const random = mulberry32(SEED + 1);
    for (let i = 0; i < CASES; i += 1) {
      const stability = 0.1 + random() * 400;
      const elapsed = random() * 365;
      const recall = fsrs6Recall(elapsed, stability);
      if (Math.abs(recall - 0.9) <= TOLERANCE) continue;
      expect(recall >= 0.9).toBe(stability >= elapsed);
    }
  });

  it("requiredStability is the boundary under the production scheduler too", () => {
    const random = mulberry32(SEED + 2);
    for (let i = 0; i < 500; i += 1) {
      const elapsed = 1 + random() * 120;
      const target = 0.8 + random() * 0.17;
      const needed = requiredStability(elapsed, target);
      const examAt = at(elapsed);
      // fsrs6-v1 rounds recall to 8 decimals, so step clear of the boundary by 1e-5 of S.
      expect(rExam(card(needed * (1 + 1e-5), 0), examAt, registry)).toBeGreaterThanOrEqual(target);
      expect(rExam(card(needed * (1 - 1e-5), 0), examAt, registry)).toBeLessThan(target);
    }
  });
});

describe("§3.1 golden: exam in 20 days, three items just reviewed (EA2)", () => {
  const examAt = at(20);
  it.each([
    ["X", 25, 0.915, true, 0],
    ["Y", 6, 0.8, false, 0.1],
    ["Z", 3, 0.732, false, 0.168],
  ])("%s: S = %d → R_exam %d", (_name, stability, expected, safe, shortfall) => {
    const recall = rExam(card(stability, 0), examAt, registry);
    expect(recall).toBeCloseTo(expected, 3);
    expect(recall >= 0.9).toBe(safe);
    expect(Math.max(0, 0.9 - recall)).toBeCloseTo(shortfall, 3);
  });
});

describe("R_exam properties (EA3)", () => {
  it("is 0 for an item never reviewed, and shortfall_norm is then 1", () => {
    expect(rExam(null, at(5), registry)).toBe(0);
    expect(shortfallNorm(0, 0.9)).toBe(1);
    expect(shortfallNorm(0.95, 0.9)).toBe(0);
  });

  it("does not depend on when it is asked: no review, no change (D-04)", () => {
    const item = card(6, 3);
    const examAt = at(10);
    // rExam takes no "now": the state and the exam date are all there is.
    const values = [0, 1, 5, 9.99].map(() => rExam(item, examAt, registry));
    expect(new Set(values).size).toBe(1);
  });

  it("a successful review before the exam never lowers it (Hard, Good, Easy; 2000 cases)", () => {
    const random = mulberry32(4242);
    for (let i = 0; i < 2000; i += 1) {
      const stability = 0.2 + random() * 200;
      const ago = random() * 60;
      const examIn = 0.5 + random() * 90;
      const before = card(stability, ago);
      (before.state as FsrsCardState).difficulty = 1 + random() * 9;
      const examAt = at(examIn);
      const reviewAt = at(random() * examIn * 0.999);
      for (const grade of [2, 3, 4] as const) {
        const state = fsrs6V1.next(before.state, grade, reviewAt);
        const after = { ...before, state, dueAt: new Date(state.due_at ?? 0) };
        expect(
          rExam(after, examAt, registry),
          `S=${stability} ago=${ago} exam=${examIn} grade=${grade}`,
        ).toBeGreaterThanOrEqual(rExam(before, examAt, registry));
      }
    }
  });
});
