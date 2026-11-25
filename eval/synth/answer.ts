import type { Confidence, ItemType } from "@repo/contracts";
import type { SynthConfig } from "./config";
import type { Rng } from "./rng";
import type { Student } from "./student";
import type { TrueMemory } from "./truth";

/** What a student hiddenly holds about one item, across all its exposures. */
export interface ItemMind {
  memory: TrueMemory;
  /** Believes a wrong answer (§5.2 "Misconceptions"): decided at the first exposure. */
  misconceived: boolean;
  exposures: number;
}

/** The hidden facts of one answer: the truth sidecar's review line (REQ §6). */
export interface AnswerTruth {
  /** R_true when the item was shown. */
  rTrue: number;
  /** P(correct): R + (1 − R) · g, or the misconception's pCorrect. What an oracle predicts (V1). */
  pCorrect: number;
  misconceived: boolean;
  /** Whether the student really recalled it; null while misconceived (no real attempt). */
  recalled: boolean | null;
  firstExposure: boolean;
}

/** One drawn answer, before the engine grades it. */
export interface DrawnAnswer {
  /** The intended outcome; the engine grades by option id and must agree. */
  correct: boolean;
  /**
   * Which wrong option, when wrong: an index into the item's wrong options, where 0 is the one a
   * misconceived student believes. Otherwise any of them, uniformly.
   */
  wrongIndex: number;
  confidence: Confidence;
  latencyMs: number;
  /** presentedAt + latencyMs: when the answer is submitted, so review_log.reviewed_at. */
  answeredAt: Date;
  truth: AnswerTruth;
}

const logit = (p: number) => Math.log(p / (1 - p));

/** Sure / Think so / No idea from the latent u (§5.2 "Confidence"). */
export function confidenceOf(u: number, cfg: SynthConfig): Confidence {
  if (u > cfg.confidence.sureAbove) return "sure";
  if (u > cfg.confidence.thinkSoAbove) return "think_so";
  return "no_idea";
}

/**
 * The student answers an item shown at `presentedAt`: correctness from the hidden
 * recall and the guess floor, confidence from the latent score, latency log-normal (§5.2). Then the
 * hidden memory takes the exposure: a real attempt updates it by the internal grade; a misconceived
 * one may correct the belief, which restarts the memory as a fresh item graded Hard. Mutates `mind`.
 * The draws are always taken in the same order, so one seed gives one history.
 */
export function answerItem(
  mind: ItemMind,
  /** When the item is shown: R_true is taken here. The answer comes latencyMs later. */
  presentedAt: Date,
  type: ItemType,
  /** How many wrong options the item has (MCQ: 3). */
  wrongOptions: number,
  student: Student,
  rng: Rng,
  cfg: SynthConfig,
): DrawnAnswer {
  const firstExposure = mind.exposures === 0;
  if (firstExposure) mind.misconceived = rng.chance(cfg.misconception.firstExposure);
  const misconceived = mind.misconceived;
  const rTrue = mind.memory.recall(presentedAt);
  const guess = cfg.guessRate[type];

  let correct: boolean;
  let recalled: boolean | null;
  let pCorrect: number;
  if (misconceived) {
    recalled = null;
    pCorrect = cfg.misconception.pCorrect;
    correct = rng.chance(pCorrect);
  } else {
    recalled = rng.chance(rTrue);
    pCorrect = rTrue + (1 - rTrue) * guess;
    correct = recalled || rng.chance(guess);
  }
  const anyWrong = rng.int(0, Math.max(0, wrongOptions - 1));

  const [low, high] = cfg.confidence.recallClip;
  const u =
    logit(Math.min(high, Math.max(low, rTrue))) +
    student.bias +
    rng.normal(0, cfg.confidence.noiseSigma) +
    (misconceived ? cfg.misconception.confidenceBoost : 0);

  const { latency } = cfg;
  const centre = latency.baseMs[type] * student.speed * (1 + latency.slowdown * (1 - rTrue));
  const raw = rng.logNormal(Math.log(centre), latency.sigma);
  const latencyMs = Math.round(Math.min(latency.clampMs[1], Math.max(latency.clampMs[0], raw)));
  const at = new Date(presentedAt.getTime() + latencyMs);

  if (misconceived) {
    if (rng.chance(cfg.misconception.correction)) {
      mind.misconceived = false;
      mind.memory.start(at, 2);
    }
  } else {
    mind.memory.review(at, recalled === true);
  }
  mind.exposures += 1;

  return {
    correct,
    wrongIndex: misconceived ? 0 : anyWrong,
    confidence: confidenceOf(u, cfg),
    latencyMs,
    answeredAt: at,
    truth: { rTrue, pCorrect, misconceived, recalled, firstExposure },
  };
}
