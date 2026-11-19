import type { QueueConfig } from "../config";
import type { Ranked } from "./rank";

export interface SelectInput {
  /** The old pool (due ∪ open misconception), in rank order. */
  old: readonly Ranked[];
  /** The new pool, in rank order. */
  fresh: readonly Ranked[];
  /** Slots. */
  N: number;
  /** newCap = N: a cold start (06 §6), or a "study more" extension (06 §8). */
  liftNewCap: boolean;
  cfg: QueueConfig;
}

export type Picked = Ranked & { reserved: boolean };

export interface Selection {
  /** Reserved misconceptions first, then old items, then new ones, each group in rank order. */
  picked: Picked[];
  qNew: number;
  qOld: number;
  misReserve: number;
  /** The old pool fills every slot: no new items (the backlog override). */
  backlog: boolean;
}

/**
 * A cap, a reserve and a remainder (06-queue-ranker.md §6, D-09):
 * new items ≤ 25 % of N and only in slots old items don't need; old pool ≥ N ⇒ no new items
 * (backlog); 15 % of N reserved for open misconceptions, the rest of them competing in the old
 * pool; a short answer is skipped once the session cap of them is picked. Pure.
 */
export function select({ old, fresh, N, liftNewCap, cfg }: SelectInput): Selection {
  const newCap = liftNewCap ? N : Math.round(cfg.newShare * N);
  const qNew = Math.min(fresh.length, Math.max(0, Math.min(N - old.length, newCap)));
  const qOld = N - qNew;
  const misPool = old.filter((candidate) => candidate.features.mis === 1);
  const misReserve = Math.min(misPool.length, Math.round(cfg.misconceptionReserveShare * N));

  const picked: Picked[] = [];
  const ids = new Set<string>();
  let shortAnswers = 0;

  /** Picks up to `count` items of `pool`, in order, skipping picked ones and capped short answers. */
  const take = (pool: readonly Ranked[], count: number, reserved: boolean) => {
    let taken = 0;
    for (const candidate of pool) {
      if (taken >= count) return;
      if (ids.has(candidate.itemId)) continue;
      if (candidate.type === "short_answer") {
        if (shortAnswers >= cfg.shortAnswerSessionCap) continue;
        shortAnswers += 1;
      }
      ids.add(candidate.itemId);
      picked.push({ ...candidate, reserved });
      taken += 1;
    }
  };

  take(misPool, misReserve, true);
  take(old, qOld - picked.length, false);
  take(fresh, qNew, false);

  return { picked, qNew, qOld, misReserve, backlog: old.length >= N };
}
