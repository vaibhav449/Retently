import type { ItemType } from "@repo/contracts";
import type { QueueConfig } from "../config";
import { clamp } from "./features";
import { byRank, type Ranked } from "./rank";

const ITEM_TYPES: readonly ItemType[] = ["mcq", "cloze", "short_answer"];

/** Seconds one item of each type is expected to take, the reveal included (06 §5). */
export type CostModel = Readonly<Record<ItemType, number>>;

/**
 * cost_sec(type) = clamp(the user's median latency for the type, or the prior, 5, 120) + 10
 * (06-queue-ranker.md §5). A missing or null median uses the prior. Pure.
 */
export function costModel(
  mediansMs: Partial<Record<ItemType, number | null>>,
  cfg: QueueConfig,
): CostModel {
  const [low, high] = cfg.costClampSec;
  const cost = (type: ItemType): number => {
    const medianMs = mediansMs[type];
    const base = medianMs == null ? cfg.costPriorSec[type] : medianMs / 1000;
    return clamp(base, low, high) + cfg.feedbackSec;
  };
  return Object.fromEntries(ITEM_TYPES.map((type) => [type, cost(type)])) as Record<
    ItemType,
    number
  >;
}

/**
 * avg_cost_sec (06 §5, QD-7): the mean cost, under `model`, of the item types of the user's newest
 * solo reviews (at most cfg.costWindow of them); the prior without any. Pure.
 */
export function avgCostSec(
  recentTypes: readonly ItemType[],
  model: CostModel,
  cfg: QueueConfig,
): number {
  if (recentTypes.length === 0) return cfg.costPriorAvgSec;
  let total = 0;
  for (const type of recentTypes) total += model[type];
  return total / recentTypes.length;
}

/** N = floor(budget / average cost) (06 §5). */
export function slotsFor(budgetSec: number, averageCostSec: number): number {
  if (!(averageCostSec > 0)) throw new RangeError(`slotsFor: average cost ${averageCostSec} s`);
  return Math.max(0, Math.floor(budgetSec / averageCostSec));
}

/**
 * The trim of 06 §5: while the selection costs more than budget × (1 + slack), drop the
 * lowest-ranked item outside the misconception reserve. Reserved items are never dropped. Keeps
 * the input's order; `selected` is left as it was. Pure.
 */
export function trim<T extends Ranked & { reserved: boolean }>(
  selected: readonly T[],
  model: CostModel,
  budgetSec: number,
  slack: number,
): T[] {
  const kept = [...selected];
  const limit = budgetSec * (1 + slack);
  let total = kept.reduce((sum, item) => sum + model[item.type], 0);
  while (total > limit) {
    let worst = -1;
    kept.forEach((item, index) => {
      if (item.reserved) return;
      const current = kept[worst];
      if (current === undefined || byRank(item, current) > 0) worst = index;
    });
    const dropped = kept[worst];
    if (dropped === undefined) break;
    kept.splice(worst, 1);
    total -= model[dropped.type];
  }
  return kept;
}
