import { createRegistry, fsrs6V1, placeholderV0, type SchedulerRegistry } from "@repo/scheduler";
import type { GradingConfig } from "./grading/mapping";
import type { Clock } from "./record/recordReview";

/** The wall clock, for production callers. Tests, replays and simulated students pass their own. */
export const systemClock: Clock = { now: () => new Date() };

/** Grading in production (05-review-pipeline.md §4, §5; D-15, D-26). Tests inject their own. */
export const DEFAULT_GRADING: GradingConfig = {
  /** Fast ⟺ latency ≤ fastRatio × median. */
  fastRatio: 1,
  latency: {
    /** How many of the user's newest solo reviews of the item type the median looks at. */
    window: 50,
    /** With fewer valid samples there is no median, so Sure + correct is Good (D-15). */
    minSamples: 10,
    /** Longer answers (tab left open) are not samples. They are still logged raw. */
    maxMs: 120_000,
  },
};

/** How long one process may reuse a computed median (05 §4). */
export const LATENCY_MEDIAN_CACHE_TTL_MS = 5 * 60_000;
/** At most this many (user, item type) medians are cached per process. */
export const LATENCY_MEDIAN_CACHE_MAX_ENTRIES = 10_000;

/**
 * The zone of a user without revision_settings, or with a zone Intl does not know. Equals the
 * column default of revision_settings.timezone (D-22).
 */
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

/**
 * New cards are scheduled with fsrs6-v1. placeholder-v0 stays registered because a stored state is
 * only ever advanced by the scheduler that wrote it: cards from Phase 1 keep their placeholder state
 * until `npm run engine:rebuild` replays their log through FSRS (04-scheduler.md §8).
 */
export function createDefaultRegistry(): SchedulerRegistry {
  return createRegistry([placeholderV0, fsrs6V1], "fsrs6-v1");
}
