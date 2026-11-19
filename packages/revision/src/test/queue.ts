import type { ItemType } from "@repo/contracts";
import type { FsrsCardState } from "@repo/scheduler";
import { DEFAULT_QUEUE } from "../config";
import type { Candidate, Features, SeenCard } from "../queue/features";
import { type Ranked, score } from "../queue/rank";

/** A valid v4 UUID that sorts by `n`: unit-test item ids. */
export function uuidFor(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

/** mulberry32: a small seeded PRNG for the randomised suites. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NO_FEATURES: Features = { overdue: 0, exam: 0, mis: 0, weak: 0, cov: 0 };

/** A ranked candidate with these features, its priority scored with the default weights. */
export function ranked(opts: {
  id: number;
  topic?: string;
  type?: ItemType;
  features?: Partial<Features>;
  stabilityDays?: number;
  seen?: boolean;
}): Ranked {
  const features = { ...NO_FEATURES, ...opts.features };
  return {
    itemId: uuidFor(opts.id),
    type: opts.type ?? "mcq",
    topicKey: opts.topic ?? "T1",
    card: (opts.seen ?? features.cov === 0) ? fsrsCard({ stability: 1, dueAt: new Date(0) }) : null,
    features,
    priority: score(features, DEFAULT_QUEUE.weights),
    stabilityDays: opts.stabilityDays ?? 1,
  };
}

const DAY_MS = 86_400_000;

/** An fsrs6-v1 card with stability S, due at `dueAt` (last reviewed S days earlier). */
export function fsrsCard(opts: {
  stability: number;
  dueAt: Date;
  misconceptionUntil?: Date | null;
}): SeenCard {
  const lastReview = new Date(opts.dueAt.getTime() - opts.stability * DAY_MS);
  const state: FsrsCardState = {
    kind: "fsrs",
    difficulty: 5,
    stability: opts.stability,
    last_review_at: lastReview.toISOString(),
    due_at: opts.dueAt.toISOString(),
    reps: 3,
    lapses: 0,
    scheduled_days: Math.max(1, Math.round(opts.stability)),
  };
  return {
    schedulerVersion: "fsrs6-v1",
    state,
    dueAt: opts.dueAt,
    misconceptionUntil: opts.misconceptionUntil ?? null,
  };
}

/** A candidate for the pure pipeline. */
export function candidate(
  id: number,
  card: SeenCard | null,
  opts: { topic?: string; type?: ItemType } = {},
): Candidate {
  return { itemId: uuidFor(id), type: opts.type ?? "mcq", topicKey: opts.topic ?? "T1", card };
}
