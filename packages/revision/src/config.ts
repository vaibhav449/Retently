import {
  EXAM_DEFAULT_TARGET,
  EXAM_MAX_TOPIC_KEYS,
  EXAM_TARGET_BOUNDS,
  type ItemType,
} from "@repo/contracts";
import {
  createRegistry,
  fsrs6V1,
  type Grade,
  placeholderV0,
  type SchedulerRegistry,
} from "@repo/scheduler";
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
 * The transaction that builds or extends a day's plan (06-queue-ranker.md §8). It holds one
 * connection for the session lock while the pools load through the others, so under load it can
 * wait for a connection, and run, longer than Prisma's defaults (2 s and 5 s): those turned a
 * busy moment into a 500 (P2028, "Unable to start a transaction in the given time"). It still
 * fails, rather than hangs, past these.
 */
export const SESSION_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/**
 * The zone of a user without revision_settings, or with a zone Intl does not know. Equals the
 * column default of revision_settings.timezone (D-22).
 */
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

/** The daily queue's constants (06-queue-ranker.md, 10-implementation-plan.md §2). */
export interface QueueConfig {
  /** Stored in every session's meta, with a hash of this whole object. */
  rankerVersion: string;
  /** w1..w5 of priority = Σ wᵢ · featureᵢ (06 §4). */
  weights: {
    overdue: number;
    exam: number;
    misconception: number;
    weakness: number;
    coverage: number;
  };
  /** overdue_pressure never exceeds this (06 §3.1, D-16). */
  overdueCap: number;
  /** overdue_pressure divides by at least this many days of stability (06 §3.1). */
  stabilityFloorDays: number;
  /** New items take at most this share of N, unless the cap is lifted (06 §6, D-09). */
  newShare: number;
  /** Slots reserved for open misconceptions, as a share of N (06 §6, D-09). */
  misconceptionReserveShare: number;
  /** A user with fewer solo reviews than this gets the new-item cap lifted to N (cold start). */
  coldStartReviews: number;
  /** At most this many short answers per selection (06 §6). */
  shortAnswerSessionCap: number;
  /** The budget of a user without revision_settings (06 §5). */
  defaultBudgetSec: number;
  /** The CHECK on revision_settings.daily_budget_sec; a stored value is clamped to it too. */
  budgetBoundsSec: readonly [number, number];
  /** Added to every item's cost: reading the reveal (06 §5). */
  feedbackSec: number;
  /** An item type's cost without a latency median, before the feedback time (06 §5). */
  costPriorSec: Readonly<Record<ItemType, number>>;
  /** The median or prior is clamped to this range before the feedback time is added. */
  costClampSec: readonly [number, number];
  /** Trim while the plan costs more than budget × (1 + trimSlack) (06 §5). */
  trimSlack: number;
  /** The new pool holds at most this many items (06 §2). */
  newPoolLimit: number;
  /** The average cost is taken over this many of the user's newest solo reviews (06 §5). */
  costWindow: number;
  /** The average cost of a user with no solo reviews (06 §5). */
  costPriorAvgSec: number;
  /** The item types the review screen can present; nothing else enters a plan. MCQ only for now. */
  servedTypes: readonly ItemType[];
  /**
   * The exam term's constants (07 §4.1): ramp = exp(−days to the exam / tauDays), and an in-scope
   * item gets ramp · (scopeShare + (1 − scopeShare) · shortfall_norm).
   */
  exam: { tauDays: number; scopeShare: number };
}

/** The queue in production (06-queue-ranker.md; 10-implementation-plan.md §2). Tests inject their own. */
export const DEFAULT_QUEUE: QueueConfig = {
  rankerVersion: "ranker-v1",
  weights: { overdue: 1.0, exam: 2.0, misconception: 5.0, weakness: 1.0, coverage: 0.5 },
  overdueCap: 10,
  stabilityFloorDays: 0.1,
  newShare: 0.25,
  misconceptionReserveShare: 0.15,
  coldStartReviews: 20,
  shortAnswerSessionCap: 4,
  defaultBudgetSec: 900,
  budgetBoundsSec: [300, 3600],
  feedbackSec: 10,
  costPriorSec: { mcq: 20, cloze: 20, short_answer: 60 },
  costClampSec: [5, 120],
  trimSlack: 0.15,
  newPoolLimit: 200,
  costWindow: 100,
  costPriorAvgSec: 30,
  servedTypes: ["mcq"],
  exam: { tauDays: 10, scopeShare: 0.5 },
};

/** Exam mode's constants (07-exam-mode.md). The exam term's are in QueueConfig.exam. */
export interface ExamConfig {
  /** target_retention outside this range is refused (07 §6; the CHECK on exams). */
  targetBounds: readonly [number, number];
  /** An exam created without a target. */
  defaultTarget: number;
  /**
   * fsrs6-v1's request_retention. Up to it, exam-due adds nothing (07 §4.2) and the forecast uses
   * due dates only; above it, the forecast also reviews items once they fall below the target.
   */
  schedulerRetention: number;
  /** exam_date at most this many days after the user's local today (EM-12). */
  maxDaysAhead: number;
  /** At most this many exams on today or later per user (EM-12). */
  maxUpcomingExams: number;
  /** At most this many notes per exam. */
  maxScopeKeys: number;
  /** The simulation grades every review this (07 §5.1). */
  assumedGrade: Grade;
  /** Simulated reviews happen this many hours after the local day starts (07 §5.1). */
  middayHours: number;
  /** λ is the Again share of this many newest solo reviews (07 §5.3). */
  lapseWindow: number;
  /** With fewer solo reviews than this, λ is lapsePrior. */
  lapseMinReviews: number;
  lapsePrior: number;
  /** Buckets of the R_exam histogram. */
  histogramBuckets: number;
  /** A computed forecast is reused for this long (07 §5.2). */
  cacheTtlMs: number;
  /** At most this many forecasts are cached per process. */
  cacheMaxEntries: number;
}

/** Exam mode in production (07-exam-mode.md). Tests inject their own. */
export const DEFAULT_EXAM: ExamConfig = {
  targetBounds: EXAM_TARGET_BOUNDS,
  defaultTarget: EXAM_DEFAULT_TARGET,
  schedulerRetention: 0.9,
  maxDaysAhead: 365,
  maxUpcomingExams: 10,
  maxScopeKeys: EXAM_MAX_TOPIC_KEYS,
  assumedGrade: 3,
  middayHours: 12,
  lapseWindow: 200,
  lapseMinReviews: 30,
  lapsePrior: 0.15,
  histogramBuckets: 10,
  cacheTtlMs: 10 * 60_000,
  cacheMaxEntries: 500,
};

/**
 * New cards are scheduled with fsrs6-v1. placeholder-v0 stays registered because a stored state is
 * only ever advanced by the scheduler that wrote it: cards from Phase 1 keep their placeholder state
 * until `npm run engine:rebuild` replays their log through FSRS (04-scheduler.md §8).
 */
export function createDefaultRegistry(): SchedulerRegistry {
  return createRegistry([placeholderV0, fsrs6V1], "fsrs6-v1");
}
