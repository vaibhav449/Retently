import { daysBetween, type SchedulerRegistry } from "@repo/scheduler";
import type { QueueConfig } from "../config";
import type { Candidate } from "../queue/features";
import { rExam, shortfallNorm } from "./recall";

/** An exam the queue plans for: on a later instant than now (07 §4.3). */
export interface ActiveExam {
  id: string;
  /** The first instant of exam_date in the user's zone. */
  examAt: Date;
  /** "YYYY-MM-DD", for the why line's "in 5 days". */
  examDate: string;
  target: number;
  /** Topic keys, "src:<source_id>". */
  scope: ReadonlySet<string>;
}

/** ramp = exp(−days / τ) (07 §4.1): near 0 a month out, near 1 the day before. Pure. */
export function ramp(daysToExam: number, tauDays: number): number {
  return Math.exp(-daysToExam / tauDays);
}

/** The exam behind an item's exam term, and the item's predicted recall on that exam's day. */
export interface ExamTerm {
  term: number;
  exam: ActiveExam;
  rExam: number;
}

/**
 * exam_term (07 §4.1, ER3.2): over the exams after `now` whose scope holds the candidate's topic,
 * the largest ramp · (scopeShare + (1 − scopeShare) · shortfall_norm); null when none does (the
 * term is then 0). A never-reviewed item has R_exam = 0, so its term is the whole ramp. Ties go
 * to the earlier exam, then the smaller id. In [0, 1]. Pure.
 */
export function examTermFor(
  candidate: Candidate,
  exams: readonly ActiveExam[],
  now: Date,
  registry: SchedulerRegistry,
  cfg: QueueConfig["exam"],
): ExamTerm | null {
  let best: ExamTerm | null = null;
  for (const exam of exams) {
    if (exam.examAt.getTime() <= now.getTime() || !exam.scope.has(candidate.topicKey)) continue;
    const recall = rExam(candidate.card, exam.examAt, registry);
    const share = cfg.scopeShare + (1 - cfg.scopeShare) * shortfallNorm(recall, exam.target);
    const term = ramp(daysBetween(exam.examAt, now), cfg.tauDays) * share;
    if (best === null || term > best.term || (term === best.term && before(exam, best.exam))) {
      best = { term, exam, rExam: recall };
    }
  }
  return best;
}

function before(a: ActiveExam, b: ActiveExam): boolean {
  const at = a.examAt.getTime() - b.examAt.getTime();
  return at !== 0 ? at < 0 : a.id < b.id;
}

/**
 * Exam-due (07 §4.2, ER3.3): an item not due today, in the scope of an exam after `now`, whose
 * recall now is below that exam's target. Empty at the default target of 0.9 by construction:
 * R < 0.9 already means due. Pass cards that are not due today. Pure.
 */
export function isExamDue(
  candidate: Candidate,
  exams: readonly ActiveExam[],
  now: Date,
  registry: SchedulerRegistry,
): boolean {
  const { card } = candidate;
  if (card === null) return false;
  let recall: number | null = null;
  for (const exam of exams) {
    if (exam.examAt.getTime() <= now.getTime() || !exam.scope.has(candidate.topicKey)) continue;
    recall ??= registry.get(card.schedulerVersion).retrievability(card.state, now);
    if (recall < exam.target) return true;
  }
  return false;
}
