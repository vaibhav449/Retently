import { createRegistry, fsrs6V1, placeholderV0, type SchedulerRegistry } from "@repo/scheduler";
import type { GradingConfig } from "./grading/mapping";
import type { Clock } from "./record/recordReview";

/** The wall clock, for production callers. Tests, replays and simulated students pass their own. */
export const systemClock: Clock = { now: () => new Date() };

/** Grading in production: an answer is fast when it took at most the median time (05 §4). */
export const DEFAULT_GRADING: GradingConfig = { fastRatio: 1 };

/**
 * New cards are scheduled with fsrs6-v1. placeholder-v0 stays registered because a stored state is
 * only ever advanced by the scheduler that wrote it: cards from Phase 1 keep their placeholder state
 * until `npm run engine:rebuild` replays their log through FSRS (04-scheduler.md §8).
 */
export function createDefaultRegistry(): SchedulerRegistry {
  return createRegistry([placeholderV0, fsrs6V1], "fsrs6-v1");
}
