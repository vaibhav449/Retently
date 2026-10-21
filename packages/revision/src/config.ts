import { createRegistry, placeholderV0, type SchedulerRegistry } from "@repo/scheduler";
import type { GradingConfig } from "./grading/mapping";
import type { Clock } from "./record/recordReview";

/** The wall clock, for production callers. Tests, replays and simulated students pass their own. */
export const systemClock: Clock = { now: () => new Date() };

/** Grading in production: an answer is fast when it took at most the median time (05 §4). */
export const DEFAULT_GRADING: GradingConfig = { fastRatio: 1 };

/**
 * Phase 1 schedules new cards with placeholder-v0. FSRS becomes the active scheduler in Phase 2,
 * after card_state is rebuilt from review_log (04-scheduler.md §8).
 */
export function createDefaultRegistry(): SchedulerRegistry {
  return createRegistry([placeholderV0], "placeholder-v0");
}
