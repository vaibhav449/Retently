import type { QueueConfig } from "../config";
import type { Candidate, Features } from "./features";

/** A candidate with its features, its priority and the stability that breaks ties. */
export interface Ranked extends Candidate {
  features: Features;
  priority: number;
  /** 0 for a new item. */
  stabilityDays: number;
}

/** priority = Σ wᵢ · featureᵢ (06-queue-ranker.md §4). Pure. */
export function score(f: Features, w: QueueConfig["weights"]): number {
  return (
    w.overdue * f.overdue +
    w.exam * f.exam +
    w.misconception * f.mis +
    w.weakness * f.weak +
    w.coverage * f.cov
  );
}

interface Rankable {
  priority: number;
  stabilityDays: number;
  itemId: string;
}

/**
 * The queue's one ordering (06 §4): priority descending, then stability ascending (more fragile
 * first), then item id ascending. Negative when `a` comes first.
 */
export function byRank(a: Rankable, b: Rankable): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.stabilityDays !== b.stabilityDays) return a.stabilityDays - b.stabilityDays;
  return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
}

/** A sorted copy of `items` in rank order; `items` is left as it was. Deterministic. */
export function rank<T extends Rankable>(items: readonly T[]): T[] {
  return [...items].sort(byRank);
}
