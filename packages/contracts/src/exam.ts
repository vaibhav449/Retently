import { z } from "zod";

/**
 * What an exam covers: topic keys, the same keys the queue ranks by. Until items carry a topic,
 * a note or PDF is its own topic, "src:<source_id>" (D-53, a deviation from 03 §2.3's
 * topic_ids uuid[]). Widened by one additive change to "topic:<uuid>" when topics land.
 */
export const topicKeySchema = z
  .string()
  .regex(/^src:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** A calendar date in the student's own time zone, "YYYY-MM-DD". */
export const localDateSchema = z.iso.date();

/** Target recall on exam day (07-exam-mode.md §4.2). Outside this range is a 400, not a clamp. */
export const EXAM_TARGET_BOUNDS = [0.8, 0.97] as const;
export const EXAM_DEFAULT_TARGET = 0.9;
/** At most this many notes per exam. */
export const EXAM_MAX_TOPIC_KEYS = 200;

const targetSchema = z.number().min(EXAM_TARGET_BOUNDS[0]).max(EXAM_TARGET_BOUNDS[1]);
const topicKeysSchema = z.array(topicKeySchema).min(1).max(EXAM_MAX_TOPIC_KEYS);

/** POST /api/exams. `exam_date` must be today or later in the student's zone. */
export const examInputSchema = z.strictObject({
  exam_date: localDateSchema,
  topic_keys: topicKeysSchema,
  /** Default 0.9. */
  target_retention: targetSchema.optional(),
});

/** PATCH /api/exams/:id: any of the fields, at least one. Only the fields sent are checked. */
export const examUpdateSchema = z
  .strictObject({
    exam_date: localDateSchema.optional(),
    topic_keys: topicKeysSchema.optional(),
    target_retention: targetSchema.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "nothing to change",
  });

/** Upcoming, on the student's local today, or past (inactive, kept for history). */
export const examStatusKindSchema = z.enum(["upcoming", "today", "past"]);

/** One exam, as the API returns it. */
export const examSchema = z.strictObject({
  id: z.uuid(),
  exam_date: localDateSchema,
  topic_keys: z.array(topicKeySchema),
  target_retention: z.number().min(EXAM_TARGET_BOUNDS[0]).max(EXAM_TARGET_BOUNDS[1]),
  /** Local calendar days from today to the exam; negative for a past exam. */
  days_left: z.number().int(),
  status: examStatusKindSchema,
  /** The scope with each note's title; title null when the note is gone or no longer readable. */
  scope: z.array(z.strictObject({ key: topicKeySchema, title: z.string().nullable() })),
  created_at: z.iso.datetime(),
});

/** GET /api/exams: today's exam, then upcoming by date, then (with ?include_past=1) past ones. */
export const examListResponseSchema = z.strictObject({ exams: z.array(examSchema) });

/** The R_exam histogram: 10 buckets of width 0.1, the last one closed (1.0 counts in it). */
export const examHistogramSchema = z.array(z.number().int().nonnegative()).length(10);

export const examForecastStatusSchema = z.enum([
  "on_track",
  "tight",
  "behind",
  "infeasible",
  "exam_passed",
  "no_items",
]);

const count = z.number().int().nonnegative();

/**
 * Every value a headline sentence needs (07 §7), by status, so a UI renders it without logic:
 * pass it to renderExamHeadline(). `target_pct` is round(100 · target); `date` is the exam date.
 */
export const examHeadlineSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("on_track"),
    n: count,
    total: count,
    target_pct: count,
    date: localDateSchema,
  }),
  z.strictObject({ status: z.literal("tight"), required: count, recommended: count }),
  z.strictObject({
    status: z.literal("behind"),
    slots: count,
    n: count,
    total: count,
    target_pct: count,
    minutes: count,
  }),
  z.strictObject({
    status: z.literal("infeasible"),
    n: count,
    total: count,
    target_pct: count,
    date: localDateSchema,
  }),
  z.strictObject({ status: z.literal("exam_passed"), date: localDateSchema }),
  z.strictObject({ status: z.literal("no_items") }),
]);

/**
 * GET /api/exams/:id/forecast (07-exam-mode.md §6): predicted recall on exam day if nothing more
 * is studied, the daily plan that gets every question to the target, and where the current pace
 * leads. Adds `plan.histogram` (now vs with the plan), `headline`, `approximate` and `lapse_rate`
 * to 07 §6, and names the scope `topic_keys` (D-53).
 */
export const examForecastSchema = z.strictObject({
  exam: z.strictObject({
    id: z.uuid(),
    exam_date: localDateSchema,
    days_left: z.number().int(),
    target_retention: z.number(),
    topic_keys: z.array(topicKeySchema),
  }),
  /** The questions the exam covers that the review screen can serve. */
  items: z.strictObject({ total: count, seen: count, unseen: count }),
  if_nothing_more: z.strictObject({
    at_target: count,
    mean_r_exam: z.number().min(0).max(1),
    histogram: examHistogramSchema,
  }),
  plan: z.strictObject({
    /** Every question can reach the target by exam day, given enough reviews a day. */
    feasible: z.boolean(),
    /** Fewest reviews a day that get every question to the target; null when there is no plan. */
    required_per_day: count.nullable(),
    /** required_per_day × (1 + lapse_rate), rounded up. */
    recommended_per_day: count.nullable(),
    minutes_per_day: count.nullable(),
    /** Reviews on each study day, today first; empty when there is no study day left. */
    per_day: z.array(count),
    at_target_with_plan: count,
    mean_r_exam_with_plan: z.number().min(0).max(1),
    histogram: examHistogramSchema,
  }),
  at_current_pace: z.strictObject({
    slots_per_day: count,
    at_target: count,
    mean_r_exam: z.number().min(0).max(1),
  }),
  status: examForecastStatusSchema,
  headline: examHeadlineSchema,
  /** Printed under the forecast: what the simulation assumes. */
  assumptions: z.array(z.string().min(1)),
  /** Some questions are on a scheduler without FSRS's recall model, so their numbers are a proxy. */
  approximate: z.boolean(),
  scheduler_version: z.string().min(1),
  /** Share of Again grades in the student's last 200 solo reviews (0.15 with fewer than 30). */
  lapse_rate: z.number().min(0).max(1),
  computed_at: z.iso.datetime(),
});

export type TopicKey = z.infer<typeof topicKeySchema>;
export type ExamInput = z.infer<typeof examInputSchema>;
export type ExamUpdate = z.infer<typeof examUpdateSchema>;
export type ExamStatusKind = z.infer<typeof examStatusKindSchema>;
export type Exam = z.infer<typeof examSchema>;
export type ExamListResponse = z.infer<typeof examListResponseSchema>;
export type ExamForecastStatus = z.infer<typeof examForecastStatusSchema>;
export type ExamHeadline = z.infer<typeof examHeadlineSchema>;
export type ExamForecast = z.infer<typeof examForecastSchema>;

/** 07 §7's sentences, plus the two housekeeping ones. `{x}` is filled from the headline. */
export const EXAM_HEADLINE_TEMPLATES: Readonly<Record<ExamForecastStatus, string>> = {
  on_track: "On track: at your pace, {n}/{total} items should be at {target_pct}% on {date}.",
  tight: "Tight: you need ~{required}/day; plan for {recommended} to allow for mistakes.",
  behind:
    "Behind: at {slots}/day only {n}/{total} reach {target_pct}%. {minutes} min a day gets you there.",
  infeasible: "Not enough time: at best {n}/{total} items can reach {target_pct}% by {date}.",
  exam_passed: "This exam was on {date}.",
  no_items: "No questions cover this exam yet. Generate questions from its notes first.",
};

/** "12 November": exam dates in sentences. The date is a calendar date, so no zone shifts it. */
const sentenceDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** The headline sentence for a forecast. Pure. */
export function renderExamHeadline(headline: ExamHeadline): string {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(headline)) {
    values[key] =
      key === "date"
        ? sentenceDate.format(new Date(`${String(value)}T00:00:00.000Z`))
        : String(value);
  }
  return EXAM_HEADLINE_TEMPLATES[headline.status].replace(
    /\{(\w+)\}/g,
    (_match, key: string) => values[key] ?? `{${key}}`,
  );
}
