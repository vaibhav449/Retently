import {
  addLocalDays,
  DEFAULT_EXAM,
  examScopeOptions,
  localDateOf,
  stabilityMultipliers,
  userTimeZone,
} from "@repo/revision";
import type { ExamFormProps } from "./exam-form";
import { pageExamDeps } from "@/lib/exams";

/**
 * What the setup form needs from the server (ER5.1): the student's notes with their question
 * counts, their local today and the latest allowed date, and the target trade-off table, so the
 * client bundle needs no scheduler (EM-6).
 */
export async function setupProps(userId: string): Promise<Omit<ExamFormProps, "exam">> {
  const deps = pageExamDeps();
  const [options, timeZone] = await Promise.all([
    examScopeOptions(userId, deps),
    userTimeZone(deps.db, userId),
  ]);
  const today = localDateOf(deps.clock.now(), timeZone);
  const [low, high] = DEFAULT_EXAM.targetBounds;
  return {
    options,
    today,
    maxDate: addLocalDays(today, DEFAULT_EXAM.maxDaysAhead),
    multipliers: stabilityMultipliers(low, high),
    bounds: DEFAULT_EXAM.targetBounds,
    defaultTarget: DEFAULT_EXAM.defaultTarget,
  };
}
