import { DAY_MS, type Grade } from "@repo/scheduler";
import { clamp, clipParameters, default_w, FSRSAlgorithm, S_MAX, S_MIN } from "ts-fsrs";
import type { SynthConfig, TruthFamily } from "./config";
import type { Rng } from "./rng";

/**
 * A student's hidden memory of one item: what really happens in their head, which the engine never
 * sees (§5.2). The generator asks it for the true recall probability before each answer and tells
 * it what the answer did. It is deliberately not the engine's scheduler: its parameters are the
 * student's own, and one family is not FSRS-shaped at all.
 */
export interface TrueMemory {
  /** Probability of recall at `at`: 0 before the item was ever studied. */
  recall(at: Date): number;
  /**
   * The study event: the item is learned for the first time (`grade` 3) or, after a corrected
   * misconception, again from scratch (`grade` 2, §5.2 "a fresh item graded Hard").
   */
  start(at: Date, grade: 2 | 3): void;
  /** One exposure that was a real attempt to recall: recalled or not (§5.2 "True memory update"). */
  review(at: Date, recalled: boolean): void;
}

/** What a student's memories are made from: their family and their own parameters. */
export interface TruthParams {
  family: TruthFamily;
  /** FSRS-6 parameters w_s, 21 numbers (fsrsPerturbed only; recorded for every student). */
  w: number[];
  /** a_s: scales the stability (or half-life) growth of a success. */
  ability: number;
}

/**
 * w_s = clip(w_default ⊙ exp(ε)), ε ~ N(0, σ²), the decay w20 with its own σ (§5.2). Clipped to
 * ts-fsrs's valid ranges, short-term off as in the engine. Never the engine's defaults, on purpose.
 */
export function perturbedParameters(rng: Rng, cfg: SynthConfig): number[] {
  const { paramSigma, decaySigma } = cfg.fsrsTruth;
  const raw = default_w.map(
    (w, i) => w * Math.exp(rng.normal(0, i === 20 ? decaySigma : paramSigma)),
  );
  return clipParameters(raw, 0, false);
}

function daysSince(at: Date, last: Date): number {
  return Math.max(0, (at.getTime() - last.getTime()) / DAY_MS);
}

/** The student's family as a memory factory; one call per (student, item). */
export function memoryFactory(
  params: TruthParams,
  cfg: SynthConfig,
): (difficulty: number) => TrueMemory {
  if (params.family === "expHalfLife") {
    return (difficulty) => halfLifeMemory(params.ability, difficulty, cfg);
  }
  const algorithm = new FSRSAlgorithm({
    w: params.w,
    request_retention: 0.9,
    maximum_interval: 36_500,
    enable_fuzz: false,
    enable_short_term: false,
  });
  return (difficulty) => fsrsMemory(algorithm, params.ability, difficulty, cfg);
}

/**
 * fsrsPerturbed (§5.2): the FSRS-6 equations under the student's w_s, in fractional days. A
 * success multiplies S by 1 + a_s · growth (growth = what FSRS-6 alone would add), a failure is
 * FSRS-6's post-lapse stability. The internal grade is Again / Good / Easy, never Hard.
 */
function fsrsMemory(
  algorithm: FSRSAlgorithm,
  ability: number,
  /** δ, added to D at the study event. */
  delta: number,
  cfg: SynthConfig,
): TrueMemory {
  let memory: { d: number; s: number; last: Date } | null = null;
  const recallAt = (at: Date) =>
    memory === null ? 0 : algorithm.forgetting_curve(daysSince(at, memory.last), memory.s);

  return {
    recall: recallAt,
    start(at, grade) {
      memory = {
        d: clamp(algorithm.init_difficulty(grade) + delta, 1, 10),
        s: algorithm.init_stability(grade),
        last: at,
      };
    },
    review(at, recalled) {
      if (memory === null) throw new Error("review before the study event");
      const r = recallAt(at);
      const { d, s } = memory;
      if (!recalled) {
        memory = {
          d: algorithm.next_difficulty(d, 1),
          s: clamp(algorithm.next_forget_stability(d, s, r), S_MIN, S_MAX),
          last: at,
        };
        return;
      }
      const grade: Grade = r > cfg.fsrsTruth.easyAbove ? 4 : 3;
      const growth = algorithm.next_recall_stability(d, s, r, grade) / s - 1;
      memory = {
        d: algorithm.next_difficulty(d, grade),
        s: clamp(s * (1 + ability * growth), S_MIN, S_MAX),
        last: at,
      };
    },
  };
}

/**
 * expHalfLife (§5.2): R = 2^(−t / h). A success multiplies h by 1 + a_s · (1.8 − 1), a failure
 * halves it; harder items start with a shorter h. Not FSRS-shaped: no difficulty, no dependence
 * of growth on R, a different curve.
 */
function halfLifeMemory(ability: number, delta: number, cfg: SynthConfig): TrueMemory {
  const t = cfg.halfLifeTruth;
  const initial = t.initialDays * Math.exp(-t.difficultyEffect * delta);
  let memory: { h: number; last: Date } | null = null;
  const recallAt = (at: Date) =>
    memory === null ? 0 : 2 ** (-daysSince(at, memory.last) / memory.h);

  return {
    recall: recallAt,
    start(at, grade) {
      memory = { h: Math.max(t.minDays, initial * (grade === 2 ? t.restartFactor : 1)), last: at };
    },
    review(at, recalled) {
      if (memory === null) throw new Error("review before the study event");
      const h = recalled
        ? memory.h * (1 + ability * (t.successGrowth - 1))
        : Math.max(t.minDays, memory.h * t.failureFactor);
      memory = { h, last: at };
    },
  };
}
