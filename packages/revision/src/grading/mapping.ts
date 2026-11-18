import type { Confidence, ReviewContext } from "@repo/contracts";
import type { Grade } from "@repo/scheduler";
import { isMisconception } from "../misconception";

/** Everything about one answer that decides its grade (05-review-pipeline.md §5). */
export interface Signals {
  context: ReviewContext;
  /** Asked before the answer is revealed. Null for duel answers. */
  confidence: Confidence | null;
  /** Graded objectively, never self-reported. */
  correct: boolean;
  latencyMs: number | null;
  /** The user's median latency for this item type; null without enough solo reviews (§4). */
  medianMs: number | null;
}

/** What makes a latency median (05 §4). Production values are in config.ts. */
export interface LatencyConfig {
  /** How many of the user's newest solo reviews of the item type are looked at. */
  window: number;
  /** Fewer valid samples than this: no median, so a confident correct answer is Good. */
  minSamples: number;
  /** Latencies above this are not samples (tab left open). */
  maxMs: number;
}

export interface GradingConfig {
  /** An answer is fast when latencyMs ≤ fastRatio × medianMs (05 §4). */
  fastRatio: number;
  latency: LatencyConfig;
}

export interface GradeResult {
  grade: Grade;
  /** Sure but wrong: the item comes back the next day, whatever the scheduler says (05 §6). */
  misconception: boolean;
}

/** Mapping `spec-v1` (05-review-pipeline.md §5.1): confidence × correctness × speed → grade. */
export function mapGrade(s: Signals, cfg: Pick<GradingConfig, "fastRatio">): GradeResult {
  // Duels do not ask for confidence (build-plan §11.2): correct → Hard, wrong → Again.
  if (s.context === "duel" || s.confidence === null) {
    return { grade: s.correct ? 2 : 1, misconception: false };
  }
  // A miss is a miss for the scheduler; being sure about it is what makes it a misconception.
  if (!s.correct) {
    return { grade: 1, misconception: isMisconception(s) };
  }
  if (s.confidence === "sure") {
    // Without a median (cold start) there is no evidence of speed, so never Easy.
    const fast =
      s.medianMs !== null && s.latencyMs !== null && s.latencyMs <= cfg.fastRatio * s.medianMs;
    return { grade: fast ? 4 : 3, misconception: false };
  }
  // Correct but unsure is a lucky guess at best: never reward it with more than Hard.
  return { grade: 2, misconception: false };
}

/**
 * True only where mapGrade() reads the speed: solo, Sure, correct. Everywhere else the grade does
 * not depend on latency or median, so recordReview() does not query the median (DD-6).
 */
export function speedMatters(s: Pick<Signals, "context" | "confidence" | "correct">): boolean {
  return s.context === "solo" && s.confidence === "sure" && s.correct;
}
