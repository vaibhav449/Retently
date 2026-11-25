import { SYNTHETIC_EMAIL_DOMAIN } from "@repo/db";
import type { BiasGroup, ExamPlan, StudentProfile, SynthConfig, TruthFamily } from "./config";
import { DEMO_EMAIL } from "./demo";
import { studentId } from "./ids";
import { Rng } from "./rng";
import { perturbedParameters } from "./truth";

/** Everything hidden about one synthetic student (§5.2), drawn once from `seed = hash(id)`. */
export interface Student {
  index: number;
  /** users.id. */
  id: string;
  email: string;
  name: string;
  family: TruthFamily;
  biasGroup: BiasGroup;
  /** β_s: positive = over-confident. */
  bias: number;
  /** w_s (used by fsrsPerturbed; drawn for everyone, so the stream is the same for both). */
  w: number[];
  /** a_s. */
  ability: number;
  /** speed_s: multiplies every latency. */
  speed: number;
  /** q_s: the probability of being active on a given day. */
  adherence: number;
  /** The usual local hour of a session. */
  sessionHour: number;
  budgetSec: number;
  exam: ExamPlan;
}

/** The demo student is always the first: it signs in with the documented credential (REQ §4). */
export const DEMO_INDEX = 0;

/** On the synthetic domain (packages/db SYNTHETIC_EMAIL_DOMAIN), the marker of every one. */
function email(index: number): string {
  return index === DEMO_INDEX
    ? DEMO_EMAIL
    : `student-${String(index + 1).padStart(2, "0")}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/** Student `index` of the cohort `cohortSeed`. Pure: same inputs, same student. */
export function drawStudent(cohortSeed: string, index: number, cfg: SynthConfig): Student {
  const profile: StudentProfile | undefined = cfg.profiles[index % cfg.profiles.length];
  if (profile === undefined) throw new Error("config.profiles is empty");
  const id = studentId(cohortSeed, index);
  const rng = new Rng(id, "profile");
  const { mean, sd } = cfg.confidence.bias[profile.bias];
  const [alpha, beta] = cfg.adherence.activeBeta;
  const [earliest, latest] = cfg.day.sessionHours;

  return {
    index,
    id,
    email: email(index),
    name: index === DEMO_INDEX ? "Demo Student" : `Synthetic Student ${index + 1}`,
    family: profile.family,
    biasGroup: profile.bias,
    bias: rng.normal(mean, sd),
    w: perturbedParameters(rng, cfg),
    ability: rng.logNormal(0, cfg.fsrsTruth.abilitySigma),
    speed: rng.logNormal(0, cfg.latency.speedSigma),
    adherence: rng.beta(alpha, beta),
    sessionHour: Math.min(
      latest,
      Math.max(earliest, rng.normal(cfg.day.sessionHourMean, cfg.day.sessionHourSd)),
    ),
    budgetSec: profile.budgetSec,
    exam: profile.exam,
  };
}
