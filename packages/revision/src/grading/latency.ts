import type { ItemType } from "@repo/contracts";
import type { Database } from "@repo/db";
import type { LatencyConfig } from "./mapping";

export interface MedianQuery {
  userId: string;
  itemType: ItemType;
  /** The review being graded: never part of its own median (R1.2), even on a replay. */
  excludeReviewId: string;
  /** From the injected clock; drives the cache TTL. */
  now: Date;
}

/** Where recordReview() gets median_ms(user, type) from (05-review-pipeline.md §4). */
export interface LatencyMedianSource {
  /** The median latency in ms, or null without enough valid samples. */
  medianMs(query: MedianQuery): Promise<number | null>;
}

/**
 * The median of a non-empty list: the middle value, or the mean of the two middle ones (the same
 * as Postgres' percentile_cont(0.5)). Does not modify `values`.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] as number) + upper) / 2;
}

/**
 * median_ms(user, type) straight from review_log (05 §4, DD-4, DD-5): the user's newest
 * `cfg.window` solo reviews of items of that type whose latency is at most `cfg.maxMs` (the cap is
 * applied before the window), excluding the review being graded; null below `cfg.minSamples`.
 * Duels never count. Every solo outcome counts, right or wrong, retired items included (D-26).
 * Exact and never stale.
 */
export function latencyMediansFromDb(
  db: Pick<Database, "reviewLog">,
  cfg: LatencyConfig,
): LatencyMedianSource {
  return {
    async medianMs({ userId, itemType, excludeReviewId }) {
      const rows = await db.reviewLog.findMany({
        where: {
          userId,
          context: "solo",
          latencyMs: { lte: cfg.maxMs },
          id: { not: excludeReviewId },
          item: { type: itemType },
        },
        // Walks the (user_id, reviewed_at) index backwards; id breaks timestamp ties.
        orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
        take: cfg.window,
        select: { latencyMs: true },
      });
      return rows.length >= cfg.minSamples ? median(rows.map((row) => row.latencyMs)) : null;
    },
  };
}

/**
 * A per-process cache in front of `source` (05 §4, DD-8): a median may be reused for `ttlMs`,
 * measured on the query's `now` (the injected clock). Only valid medians are kept, so a user who
 * just reached the minimum sample count is never held back by a cached null. A clock that moved
 * backwards counts as stale. At `maxEntries` the oldest entry is evicted. Correctness never depends
 * on it (R1.6): the default in recordReview() is the uncached source.
 */
export function cachedLatencyMedians(
  source: LatencyMedianSource,
  opts: { ttlMs: number; maxEntries: number },
): LatencyMedianSource {
  const entries = new Map<string, { medianMs: number; computedAt: number }>();
  return {
    async medianMs(query) {
      const key = `${query.userId}:${query.itemType}`;
      const now = query.now.getTime();
      const hit = entries.get(key);
      if (hit !== undefined) {
        const age = now - hit.computedAt;
        if (age >= 0 && age < opts.ttlMs) return hit.medianMs;
        entries.delete(key);
      }

      const value = await source.medianMs(query);
      if (value !== null) {
        // A Map iterates in insertion order, so the first key is the oldest entry.
        while (entries.size >= opts.maxEntries) {
          const oldest = entries.keys().next();
          if (oldest.done) break;
          entries.delete(oldest.value);
        }
        if (opts.maxEntries > 0) entries.set(key, { medianMs: value, computedAt: now });
      }
      return value;
    },
  };
}
