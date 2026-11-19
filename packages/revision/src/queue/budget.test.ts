import { describe, expect, it } from "vitest";
import { DEFAULT_QUEUE } from "../config";
import { ranked } from "../test/queue";
import { avgCostSec, costModel, slotsFor, trim } from "./budget";

const cfg = DEFAULT_QUEUE;

describe("costModel (06 §5)", () => {
  it("uses the priors plus 10 s without medians: mcq 30, cloze 30, short answer 70", () => {
    expect(costModel({}, cfg)).toEqual({ mcq: 30, cloze: 30, short_answer: 70 });
    expect(costModel({ mcq: null }, cfg).mcq).toBe(30);
  });

  it("clamps a median to 5–120 s before adding the feedback time", () => {
    expect(costModel({ mcq: 2_000 }, cfg).mcq).toBe(15);
    expect(costModel({ mcq: 300_000 }, cfg).mcq).toBe(130);
    expect(costModel({ mcq: 12_500 }, cfg).mcq).toBe(22.5);
  });
});

describe("avgCostSec and slotsFor (06 §5, QD-7)", () => {
  const model = costModel({}, cfg);

  it("gives the 30 s prior with no reviews, so a 900 s budget is 30 slots", () => {
    expect(avgCostSec([], model, cfg)).toBe(30);
    expect(slotsFor(900, avgCostSec([], model, cfg))).toBe(30);
  });

  it("averages the cost of each recent review's item type", () => {
    expect(avgCostSec(["mcq", "mcq", "short_answer"], model, cfg)).toBeCloseTo(130 / 3, 12);
  });

  it("rounds the slot count down", () => {
    expect(slotsFor(900, 26.7)).toBe(33);
    expect(slotsFor(300, 130)).toBe(2);
    expect(() => slotsFor(900, 0)).toThrow(RangeError);
  });
});

describe("trim (06 §5)", () => {
  const model = { mcq: 30, cloze: 30, short_answer: 70 };
  const pick = (
    id: number,
    weak: number,
    reserved = false,
    type: "mcq" | "short_answer" = "mcq",
  ) => ({
    ...ranked({ id, type, features: { weak } }),
    reserved,
  });

  it("does nothing within 1.15 × the budget", () => {
    const selected = [pick(1, 0.5), pick(2, 0.4), pick(3, 0.3)];
    // 90 s ≤ 80 × 1.15 = 92 s.
    expect(trim(selected, model, 80, cfg.trimSlack)).toEqual(selected);
  });

  it("drops the lowest-priority unreserved items first, never a reserved one", () => {
    const selected = [pick(1, 0.1, true), pick(2, 0.9), pick(3, 0.2), pick(4, 0.5)];
    // 120 s against 60 × 1.15 = 69 s: two must go, the reserved lowest one stays.
    expect(trim(selected, model, 60, cfg.trimSlack).map((item) => item.itemId)).toEqual([
      selected[0]?.itemId,
      selected[1]?.itemId,
    ]);
  });

  it("keeps every reserved item even when they alone exceed the budget", () => {
    const selected = [pick(1, 0.1, true, "short_answer"), pick(2, 0.2, true, "short_answer")];
    expect(trim(selected, model, 60, cfg.trimSlack)).toEqual(selected);
  });
});
