import type { ItemType } from "@repo/contracts";
import { type CardState, daysBetween, type SchedulerRegistry } from "@repo/scheduler";

/** A user's memory of a seen item: the card_state columns the queue reads. */
export interface SeenCard {
  schedulerVersion: string;
  state: CardState;
  dueAt: Date;
  misconceptionUntil: Date | null;
}

/** One item the queue may plan: seen (with its card) or never reviewed (card null). */
export interface Candidate {
  itemId: string;
  type: ItemType;
  /** `src:<source_id>` until items carry a topic (06 §3.4, QD-9). */
  topicKey: string;
  card: SeenCard | null;
}

/** The five clamped features of 06-queue-ranker.md §3. Stored in every plan entry. */
export interface Features {
  /** overdue_pressure ∈ [0, overdueCap]. */
  overdue: number;
  /** exam_term ∈ [0, 1] (07 §4.1); 0 when no active exam covers the item. */
  exam: number;
  /** misconception_flag ∈ {0, 1}. */
  mis: number;
  /** topic_weakness ∈ [0, 1]. */
  weak: number;
  /** coverage_debt ∈ {0, 1}. */
  cov: number;
}

export interface FeatureContext {
  now: Date;
  /** The start of the user's next local day: "today" means before it. */
  cutoff: Date;
  registry: SchedulerRegistry;
  /** From topicWeakness(); a topic without seen items is missing and counts as 0. */
  weaknessByTopic: ReadonlyMap<string, number>;
  overdueCap: number;
  stabilityFloorDays: number;
}

/** The topic key of an item until topics exist: its source (06 §3.4). */
export function topicKeyOf(sourceId: string): string {
  return `src:${sourceId}`;
}

/** misconception_until is set and before the cutoff: the open-misconception test (06 §3.3). */
export function isOpenMisconception(card: SeenCard | null, cutoff: Date): boolean {
  return card?.misconceptionUntil != null && card.misconceptionUntil.getTime() < cutoff.getTime();
}

/** Due today: the effective due date (05 §6.2) is before the cutoff (06 §2, QD-17). */
export function isDueToday(card: SeenCard, cutoff: Date): boolean {
  return card.dueAt.getTime() < cutoff.getTime() || isOpenMisconception(card, cutoff);
}

/**
 * Stability in days through the scheduler that wrote the card, so every scheduler version works
 * (Q-E22); 0 for a new item.
 */
export function stabilityOf(card: SeenCard | null, registry: SchedulerRegistry): number {
  return card === null ? 0 : registry.get(card.schedulerVersion).stabilityDays(card.state);
}

/**
 * topic_weakness (06 §3.4): 1 − the mean retrievability at `now` of each topic's seen items, each
 * through its own scheduler. Pass the seen, live, readable cards of every type (QD-10). Topics
 * without seen items are missing from the map. Pure, and independent of the order of `seen`: the
 * sums run in item-id order, so a floating-point rounding can never reorder tied candidates.
 */
export function topicWeakness(
  seen: readonly Candidate[],
  now: Date,
  registry: SchedulerRegistry,
): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  const byId = (a: Candidate, b: Candidate) =>
    a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
  // loadPools() already returns them in id order; sort only a list that is not.
  const sorted = seen.every(
    (candidate, i) => i === 0 || byId(seen[i - 1] as Candidate, candidate) <= 0,
  );
  const inIdOrder = sorted ? seen : [...seen].sort(byId);
  for (const candidate of inIdOrder) {
    const { card } = candidate;
    if (card === null) continue;
    const recall = registry.get(card.schedulerVersion).retrievability(card.state, now);
    const sum = sums.get(candidate.topicKey) ?? { total: 0, count: 0 };
    sum.total += recall;
    sum.count += 1;
    sums.set(candidate.topicKey, sum);
  }
  const weakness = new Map<string, number>();
  for (const [topic, { total, count }] of sums) {
    weakness.set(topic, clamp(1 - total / count, 0, 1));
  }
  return weakness;
}

/** The five features of one candidate (06 §3). Pure: time comes from `ctx`. */
export function extractFeatures(
  candidate: Candidate,
  ctx: FeatureContext,
  /** stabilityOf(candidate.card), when the caller has it already. */
  stabilityDays: number = stabilityOf(candidate.card, ctx.registry),
  /** exam_term from examTermFor() (07 §4.1); 0 when no active exam covers the item. */
  examTerm = 0,
): Features {
  const { card } = candidate;
  const weak = ctx.weaknessByTopic.get(candidate.topicKey) ?? 0;
  if (card === null) return { overdue: 0, exam: examTerm, mis: 0, weak, cov: 1 };

  const stability = Math.max(stabilityDays, ctx.stabilityFloorDays);
  const lateDays = Math.max(0, daysBetween(ctx.now, card.dueAt));
  return {
    overdue: Math.min(lateDays / stability, ctx.overdueCap),
    exam: examTerm,
    mis: isOpenMisconception(card, ctx.cutoff) ? 1 : 0,
    weak,
    cov: 0,
  };
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
