import type { ExamForecast, ExamForecastStatus, ExamHeadline } from "@repo/contracts";
import type { SchedulerRegistry } from "@repo/scheduler";
import type { ExamConfig } from "../config";
import { localDayStarts, localDaysBetween, startOfLocalDate } from "../time";
import { atTarget, createSimulator, type SimItem, simulatePlan } from "./simulate";

/** An exams row, as the engine reads it. */
export interface StoredExam {
  id: string;
  userId: string;
  /** "YYYY-MM-DD" in the user's zone. */
  examDate: string;
  topicKeys: string[];
  target: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Everything one forecast is computed from. Read by loadForecastInput(); pure from here on. */
export interface ForecastInput {
  exam: StoredExam;
  now: Date;
  /** The user's local date at `now`. */
  today: string;
  timeZone: string;
  /** The in-scope items the queue can serve; the never-reviewed ones in the new-pool order. */
  items: SimItem[];
  registry: SchedulerRegistry;
  /** The queue's N: the user's budget over the average cost (06 §5). */
  slotsPerDay: number;
  /** The queue's average cost of one item, in seconds. */
  avgCostSec: number;
  /** Grades of the user's newest solo reviews, newest first (at most cfg.lapseWindow). */
  recentGrades: readonly number[];
}

/**
 * λ (07 §5.3): the share of Again among the newest `cfg.lapseWindow` solo grades; the prior with
 * fewer than `cfg.lapseMinReviews` of them. Pure.
 */
export function lapseRate(grades: readonly number[], cfg: ExamConfig): number {
  const window = grades.slice(0, cfg.lapseWindow);
  if (window.length < cfg.lapseMinReviews) return cfg.lapsePrior;
  return window.filter((grade) => grade === 1).length / window.length;
}

/** Counts of R_exam in `buckets` equal buckets over [0, 1]; 1.0 goes in the last. Pure. */
export function histogram(rExam: readonly number[], buckets: number): number[] {
  const counts = Array.from({ length: buckets }, () => 0);
  for (const recall of rExam) {
    const bucket = Math.min(buckets - 1, Math.max(0, Math.floor(recall * buckets)));
    counts[bucket] = (counts[bucket] as number) + 1;
  }
  return counts;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

interface Outcome {
  at_target: number;
  mean_r_exam: number;
  histogram: number[];
}

/**
 * The forecast of one exam (07-exam-mode.md §5–§7, ER4): R_exam if nothing more is studied, the
 * smallest daily capacity that gets every item to the target (and the recommended one, with the
 * lapse allowance), where the current pace leads, a status with its headline inputs, and the
 * assumptions. On the exam day there is no study day left: only "if nothing more" (EM-7). Pure;
 * the shape is examForecastSchema's.
 */
export function buildForecast(input: ForecastInput, cfg: ExamConfig): ExamForecast {
  const { exam, items } = input;
  const target = exam.target;
  const daysLeft = localDaysBetween(input.today, exam.examDate);
  const examAt = startOfLocalDate(exam.examDate, input.timeZone);
  const total = items.length;
  const seen = items.filter((item) => item.state !== null).length;
  const lambda = lapseRate(input.recentGrades, cfg);

  const outcome = (rExam: readonly number[]): Outcome => ({
    at_target: atTarget(rExam, target),
    mean_r_exam: mean(rExam),
    histogram: histogram(rExam, cfg.histogramBuckets),
  });
  // Above the scheduler's own target the queue also reviews exam-due items (07 §4.2): so does
  // the simulation, or a high target would look out of reach.
  const examDue = target > cfg.schedulerRetention;
  const simOptions = (dayStarts: readonly Date[]) => ({
    now: input.now,
    dayStarts,
    registry: input.registry,
    grade: cfg.assumedGrade,
    middayHours: cfg.middayHours,
    ...(examDue && { examDueBelow: target }),
  });
  // As things stand: no study day, R_exam straight from the stored states.
  const nothingMore = outcome(simulatePlan(items, { ...simOptions([examAt]), capacity: 0 }).rExam);

  let status: ExamForecastStatus;
  let headline: ExamHeadline;
  let plan: ExamForecast["plan"] = {
    feasible: false,
    required_per_day: null,
    recommended_per_day: null,
    minutes_per_day: null,
    per_day: [],
    at_target_with_plan: nothingMore.at_target,
    mean_r_exam_with_plan: nothingMore.mean_r_exam,
    histogram: nothingMore.histogram,
  };
  let pace: Outcome = nothingMore;
  const targetPct = Math.round(100 * target);

  if (daysLeft < 0) {
    status = "exam_passed";
    headline = { status, date: exam.examDate };
  } else if (total === 0) {
    status = "no_items";
    headline = { status };
    plan = { ...plan, feasible: true };
  } else if (daysLeft === 0) {
    // The exam day: nothing can be studied for it any more (EM-7, 07 §5.1).
    const allThere = nothingMore.at_target === total;
    plan = { ...plan, feasible: allThere };
    status = allThere ? "on_track" : "infeasible";
    headline = {
      status,
      n: nothingMore.at_target,
      total,
      target_pct: targetPct,
      date: exam.examDate,
    };
  } else {
    const simulator = createSimulator(
      items,
      simOptions(localDayStarts(input.today, daysLeft, input.timeZone)),
    );
    const search = simulator.requiredCapacity(target);
    const withPlan = outcome(search.result.rExam);
    pace = outcome(simulator.run(input.slotsPerDay).rExam);

    if (search.capacity === null) {
      plan = {
        ...plan,
        per_day: search.result.perDay,
        at_target_with_plan: withPlan.at_target,
        mean_r_exam_with_plan: withPlan.mean_r_exam,
        histogram: withPlan.histogram,
      };
      status = "infeasible";
      headline = {
        status,
        n: withPlan.at_target,
        total,
        target_pct: targetPct,
        date: exam.examDate,
      };
    } else {
      const required = search.capacity;
      const recommended = Math.ceil(required * (1 + lambda));
      const minutes = Math.ceil((recommended * input.avgCostSec) / 60);
      plan = {
        feasible: true,
        required_per_day: required,
        recommended_per_day: recommended,
        minutes_per_day: minutes,
        per_day: search.result.perDay,
        at_target_with_plan: withPlan.at_target,
        mean_r_exam_with_plan: withPlan.mean_r_exam,
        histogram: withPlan.histogram,
      };
      const slots = input.slotsPerDay;
      if (slots >= recommended) {
        status = "on_track";
        headline = { status, n: pace.at_target, total, target_pct: targetPct, date: exam.examDate };
      } else if (slots >= required) {
        status = "tight";
        headline = { status, required, recommended };
      } else {
        status = "behind";
        headline = { status, slots, n: pace.at_target, total, target_pct: targetPct, minutes };
      }
    }
  }

  const kinds = new Set(items.flatMap((item) => (item.state === null ? [] : [item.state.kind])));
  const versions = new Set(
    items.map((item) => item.schedulerVersion ?? input.registry.active.version),
  );
  return {
    exam: {
      id: exam.id,
      exam_date: exam.examDate,
      days_left: daysLeft,
      target_retention: target,
      topic_keys: exam.topicKeys,
    },
    items: { total, seen, unseen: total - seen },
    if_nothing_more: nothingMore,
    plan,
    at_current_pace: {
      slots_per_day: input.slotsPerDay,
      at_target: pace.at_target,
      mean_r_exam: pace.mean_r_exam,
    },
    status,
    headline,
    assumptions: assumptions(lambda, input.recentGrades.length < cfg.lapseMinReviews, {
      examDuePct: examDue ? targetPct : null,
      sm2: kinds.has("sm2"),
      placeholder: kinds.has("placeholder"),
      mixed: versions.size > 1,
    }),
    approximate: kinds.has("sm2") || kinds.has("placeholder"),
    scheduler_version: input.registry.active.version,
    lapse_rate: lambda,
    computed_at: input.now.toISOString(),
  };
}

/** The footnote under the forecast (07 §5.1, §5.3, §8). */
function assumptions(
  lambda: number,
  prior: boolean,
  flags: { examDuePct: number | null; sm2: boolean; placeholder: boolean; mixed: boolean },
): string[] {
  const pct = Math.round(100 * lambda);
  const lines = [
    "Every review is graded Good.",
    "Reviews come before new questions, the weakest first.",
    "One review per question per day, at midday.",
    ...(flags.examDuePct === null
      ? []
      : [
          `A question comes back as soon as its recall drops below ${flags.examDuePct}%, as your daily reviews do for this exam.`,
        ]),
    "No reviews on exam day.",
    "All your daily review slots go to this exam.",
    prior
      ? `Lapse allowance: ${pct}% extra reviews, the default until you have more reviews of your own.`
      : `Lapse allowance: ${pct}% extra reviews, from your own recent mistakes.`,
  ];
  if (flags.sm2)
    lines.push("Approximate: some questions are on SM-2, whose recall is a proxy curve.");
  if (flags.placeholder) {
    lines.push(
      "Approximate: some questions are on the placeholder scheduler, a rough recall curve.",
    );
  }
  if (flags.mixed)
    lines.push("Questions on different scheduler versions are each simulated with their own.");
  return lines;
}
