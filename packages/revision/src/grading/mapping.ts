import type { Confidence, ReviewContext } from "@repo/contracts";
import type { Grade } from "@repo/scheduler";

/** Everything about one answer that decides its grade (05-review-pipeline.md §5). */
export interface Signals {
  context: ReviewContext;
  /** Asked before the answer is revealed. Null for duel answers. */
  confidence: Confidence | null;
  /** Graded objectively, never self-reported. */
  correct: boolean;
  latencyMs: number | null;
  /** The user's median latency for this item type; null with fewer than 10 solo reviews. */
  medianMs: number | null;
}

export interface GradingConfig {
  /** An answer is fast when latencyMs ≤ fastRatio × medianMs (05 §4). */
  fastRatio: number;
}

export interface GradeResult {
  grade: Grade;
  /** Sure but wrong: the item comes back the next day, whatever the scheduler says (05 §6). */
  misconception: boolean;
}

/** Mapping `spec-v1` (05-review-pipeline.md §5.1): confidence × correctness × speed → grade. */
export function mapGrade(s: Signals, cfg: GradingConfig): GradeResult {
  // Duels do not ask for confidence (build-plan §11.2): correct → Hard, wrong → Again.
  if (s.context === "duel" || s.confidence === null) {
    return { grade: s.correct ? 2 : 1, misconception: false };
  }
  // A miss is a miss for the scheduler; being sure about it is what makes it a misconception.
  if (!s.correct) {
    return { grade: 1, misconception: s.confidence === "sure" };
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
