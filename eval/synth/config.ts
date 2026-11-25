import type { ItemType } from "@repo/contracts";
import { DEFAULT_QUEUE, DEFAULT_TIME_ZONE } from "@repo/revision";

/**
 * Every constant of the synthetic-student generator. "§5.2" is 09-evaluation.md §5.2, the
 * student model; "REQ" is docs/synthetic-students/REQUIREMENTS.md; "SS-n" are the generator's own
 * choices where the spec is silent, listed in eval/README.md. Nothing below is buried in logic.
 */

/** Which hidden forgetting model a student has (§5.2 "Truth families"). */
export type TruthFamily = "fsrsPerturbed" | "expHalfLife";

/** Which way a student's confidence leans (REQ §2; §5.2 "Confidence"). */
export type BiasGroup = "over" | "calibrated" | "under";

/** Whether a student sets an exam during the simulation, and at which target (REQ §3). */
export type ExamPlan = "none" | "default" | "high";

/** The fixed part of a student, before any random draw. */
export interface StudentProfile {
  bias: BiasGroup;
  family: TruthFamily;
  exam: ExamPlan;
  /** revision_settings.daily_budget_sec, within the column's CHECK (300–3600). */
  budgetSec: number;
}

export interface SynthConfig {
  /** Written into the truth sidecar's header, with a hash of this whole object. */
  version: string;

  /** The default cohort of `npm run db:seed` (REQ §4). */
  cohort: { students: number; days: number; seed: string };
  /** `--quick`: what tests and CI seed (REQ §4). */
  quick: { students: number; days: number };
  /** Students seeded at once. They share nothing, so the order of their writes changes no row. */
  concurrency: number;

  /**
   * Student i gets profiles[i % length] (SS-2): a fixed rotation rather than independent draws, so
   * even the 3-student quick cohort has an over- and an under-confident student, a non-FSRS truth
   * and an exam. Over 10 students: 5 over / 2 calibrated / 3 under, 2 of 10 expHalfLife (the
   * minority, §5.2), 5 of 10 with an exam, 1 of them at 0.95.
   */
  profiles: readonly StudentProfile[];

  /** revision_settings.timezone of every synthetic student. */
  timeZone: string;

  /** §5.2 "True forgetting parameters", "Ability", "Item difficulty", "True memory update". */
  fsrsTruth: {
    /** ε ~ N(0, σ²) per parameter, w_s = clip(w_default ⊙ exp(ε)). */
    paramSigma: number;
    /** σ of ε for the decay, w20. */
    decaySigma: number;
    /** a_s ~ LogNormal(0, σ²) scales the stability-growth term of a success. */
    abilitySigma: number;
    /** δ ~ N(0, σ²) added to D at the first exposure, clamped to [1, 10]. */
    difficultySigma: number;
    /** A success is Easy above this recall, else Good. */
    easyAbove: number;
  };

  /** §5.2 "Truth families": expHalfLife, R = 2^(−t / h). The spec gives only the ×1.8. */
  halfLifeTruth: {
    /** h at the study event, before difficulty (SS-5). */
    initialDays: number;
    /** h is multiplied by exp(−effect · δ), δ the item's difficulty draw (SS-5). */
    difficultyEffect: number;
    /** Per success, h ×= 1 + a_s · (growth − 1) (§5.2: ×1.8). */
    successGrowth: number;
    /** Per failure, h ×= this (SS-5). */
    failureFactor: number;
    /** h never drops below this (SS-5). */
    minDays: number;
    /** A restart after a corrected misconception starts at initialDays × this (§5.2 "graded Hard"). */
    restartFactor: number;
  };

  /** §5.2 "True recall": P(correct) = R + (1 − R) · g. */
  guessRate: Readonly<Record<ItemType, number>>;

  /** §5.2 "Confidence": u = logit(clip(R)) + β_s + η. */
  confidence: {
    /** β_s by group: N(mean, sd²) (SS-2). Mixed 5:2:3 they average ≈ the spec's 0.4. */
    bias: Readonly<Record<BiasGroup, { mean: number; sd: number }>>;
    /** η ~ N(0, σ²). */
    noiseSigma: number;
    /** R is clipped to this range before the logit. */
    recallClip: readonly [number, number];
    /** Sure if u > this. */
    sureAbove: number;
    /** Think so if u > this (and not Sure); else No idea. */
    thinkSoAbove: number;
  };

  /** §5.2 "Misconceptions". */
  misconception: {
    /** π: an item is misconceived at its first exposure with this probability. */
    firstExposure: number;
    /** P(correct) while misconceived. */
    pCorrect: number;
    /** Added to u while misconceived, so Sure is likely. */
    confidenceBoost: number;
    /** ρ: after any exposure the belief is corrected with this probability. */
    correction: number;
  };

  /** §5.2 "Latency": ln L ~ N(ln(m_type · speed_s · (1 + slowdown · (1 − R))), σ²). */
  latency: {
    baseMs: Readonly<Record<ItemType, number>>;
    /** speed_s ~ LogNormal(0, σ²). */
    speedSigma: number;
    slowdown: number;
    sigma: number;
    /** Kept inside what the answer route accepts (0–600 000 ms, 05 §10). */
    clampMs: readonly [number, number];
  };
  /** Reading the reveal after each answer: the queue's own feedback time (06 §5), as REQ §1 asks. */
  revealMs: number;

  /** §5.2 "Adherence". */
  adherence: {
    /** q_s ~ Beta(α, β), the share of days a student is active. */
    activeBeta: readonly [number, number];
    /** On an active day the whole session is done with this probability, else a random prefix. */
    complete: number;
  };

  /** When in the local day things happen (SS-4). */
  day: {
    /** The local hour a day's new questions (and new notes) appear: before any session. */
    releaseHour: number;
    /** An exam is set up this many hours after the release, still before any session. */
    examSetupHour: number;
    /** A student's usual session hour ~ N(mean, sd²), clamped to `sessionHours`. */
    sessionHourMean: number;
    sessionHourSd: number;
    /** Day-to-day jitter around the usual hour, N(0, sd²) hours. */
    sessionJitterHours: number;
    /** Sessions start within these local hours, so even a long one ends before midnight. */
    sessionHours: readonly [number, number];
  };

  /** §5.2 "Content"; REQ §3. */
  content: {
    /** A batch of new questions appears every this many simulated days, from day 0. */
    releaseEveryDays: number;
    releaseBatch: number;
    /**
     * The bank's last this many questions are held back and appear on the end day itself, at its
     * release hour or at the end if that is earlier (SS-7): "questions generated this morning".
     * So whoever opens /review at the end, the demo student included, always gets a real session,
     * even a student who has nothing due that day.
     */
    endDayBatch: number;
    /** Facts (sentences) per chunk of a note. */
    factsPerChunk: number;
    /**
     * Item types by share (§5.2 says 70 % MCQ, 20 % cloze, 10 % short). MCQ-only until the
     * review screen asks the others (REQ §3): this is the switch to flip when they ship, together
     * with DEFAULT_QUEUE.servedTypes and the answer model (answer.ts) for the new types.
     */
    typeMix: Readonly<Partial<Record<ItemType, number>>>;
  };

  /** REQ §3: exams set during the simulation. */
  exams: {
    /** The exam is set up this many days before the end, uniformly (clamped to day 1 or later). */
    setupDaysBeforeEnd: readonly [number, number];
    /** The exam date is this many local days after the end's local date, uniformly. */
    daysAfterEnd: readonly [number, number];
    /** It covers this many of the notes the student has by then, uniformly. */
    scopeNotes: readonly [number, number];
    /** target_retention of an ExamPlan "high" exam; "default" sends none (the API's 0.9). */
    highTarget: number;
  };
}

export const DEFAULT_SYNTH: SynthConfig = {
  version: "synth-v1",

  cohort: { students: 20, days: 60, seed: "retently-synth" },
  quick: { students: 3, days: 14 },
  concurrency: 4,

  profiles: [
    { bias: "over", family: "fsrsPerturbed", exam: "default", budgetSec: 900 },
    { bias: "under", family: "fsrsPerturbed", exam: "none", budgetSec: 900 },
    { bias: "calibrated", family: "expHalfLife", exam: "default", budgetSec: 600 },
    { bias: "over", family: "fsrsPerturbed", exam: "high", budgetSec: 1200 },
    { bias: "over", family: "fsrsPerturbed", exam: "none", budgetSec: 900 },
    { bias: "under", family: "fsrsPerturbed", exam: "default", budgetSec: 900 },
    { bias: "calibrated", family: "fsrsPerturbed", exam: "none", budgetSec: 600 },
    { bias: "over", family: "expHalfLife", exam: "none", budgetSec: 900 },
    { bias: "over", family: "fsrsPerturbed", exam: "default", budgetSec: 1200 },
    { bias: "under", family: "fsrsPerturbed", exam: "none", budgetSec: 900 },
  ],

  timeZone: DEFAULT_TIME_ZONE,

  fsrsTruth: {
    paramSigma: 0.15,
    decaySigma: 0.1,
    abilitySigma: 0.25,
    difficultySigma: 1,
    easyAbove: 0.97,
  },

  halfLifeTruth: {
    // FSRS-6's first Good (S ≈ 2.3 days) keeps R ≥ 0.9 for 2.3 days; a 6-day half-life drops to
    // 0.71 by the engine's first due date (3 days), so this truth forgets faster, but not absurdly.
    initialDays: 6,
    difficultyEffect: 0.3,
    successGrowth: 1.8,
    failureFactor: 0.5,
    minDays: 0.25,
    restartFactor: 0.6,
  },

  guessRate: { mcq: 0.25, cloze: 0.02, short_answer: 0.02 },

  confidence: {
    bias: {
      over: { mean: 1.0, sd: 0.25 },
      calibrated: { mean: 0.2, sd: 0.2 },
      under: { mean: -0.4, sd: 0.25 },
    },
    noiseSigma: 0.8,
    recallClip: [0.02, 0.98],
    // SS-6: §5.2 cuts at 1.2 / −0.4. Under the engine's own 0.9 target, recall at a review is
    // mostly 0.85–0.95 (logit ≈ 1.7–2.9), where that cut makes ~95 % of answers Sure whatever the
    // bias, and a cohort that always says Sure cannot show a bias (V4). Here Sure ≈ "90 % sure"
    // (logit 0.9 ≈ 2.2) and Think so ≈ "60 %" (logit 0.6 ≈ 0.4).
    sureAbove: 2.2,
    thinkSoAbove: 0.4,
  },

  misconception: { firstExposure: 0.08, pCorrect: 0.05, confidenceBoost: 2.0, correction: 0.7 },

  latency: {
    baseMs: { mcq: 8_000, cloze: 12_000, short_answer: 40_000 },
    speedSigma: 0.3,
    slowdown: 0.8,
    sigma: 0.35,
    clampMs: [500, 600_000],
  },
  revealMs: DEFAULT_QUEUE.feedbackSec * 1_000,

  adherence: { activeBeta: [6, 2], complete: 0.9 },

  day: {
    releaseHour: 8,
    examSetupHour: 8.5,
    sessionHourMean: 19,
    sessionHourSd: 2.5,
    sessionJitterHours: 1,
    sessionHours: [9, 22.5],
  },

  content: {
    releaseEveryDays: 7,
    releaseBatch: 30,
    endDayBatch: 6,
    factsPerChunk: 3,
    typeMix: { mcq: 1 },
  },

  exams: {
    setupDaysBeforeEnd: [8, 20],
    daysAfterEnd: [3, 14],
    scopeNotes: [2, 4],
    highTarget: 0.95,
  },
};
