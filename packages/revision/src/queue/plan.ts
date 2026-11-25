import { createHash } from "node:crypto";
import { type ItemType, type ReviewCategory, reviewCategorySchema } from "@repo/contracts";
import type { SchedulerRegistry } from "@repo/scheduler";
import { z } from "zod";
import type { QueueConfig } from "../config";
import { type ActiveExam, type ExamTerm, examTermFor, isExamDue } from "../exam/term";
import { avgCostSec, costModel, slotsFor, trim } from "./budget";
import {
  type Candidate,
  extractFeatures,
  type FeatureContext,
  stabilityOf,
  topicWeakness,
} from "./features";
import { interleave } from "./interleave";
import { byRank, rank, type Ranked, score } from "./rank";
import { select } from "./select";

/**
 * One entry of review_sessions.plan (06-queue-ranker.md §8). Internal JSON, not a contract: it is
 * validated on every read (QD-15). `cost_sec` is the item's cost when it was planned, so the
 * remaining time needs no latency query.
 */
export const planEntrySchema = z.object({
  item_id: z.uuid(),
  category: reviewCategorySchema,
  topic_key: z.string().min(1),
  priority: z.number(),
  features: z.object({
    overdue: z.number(),
    exam: z.number(),
    mis: z.number(),
    weak: z.number(),
    cov: z.number(),
  }),
  cost_sec: z.number().nonnegative(),
  /** 0 = the day's first plan, k = added by the k-th "study more". */
  ext: z.number().int().nonnegative(),
  /**
   * In the plan only through the exam-due pool (07 §4.2): not due today, so it stays open until
   * answered instead of being skipped at the cutoff (EM-10). Absent otherwise.
   */
  exam_due: z.literal(true).optional(),
  /** The exam behind features.exam, and the item's predicted recall on its day (EM-11). */
  exam_ref: z
    .object({ exam_id: z.uuid(), exam_date: z.iso.date(), r_exam: z.number().min(0).max(1) })
    .optional(),
});

export const planSchema = z.array(planEntrySchema);

/** review_sessions.meta: what the plan was built from (06 §8). Validated on every read. */
export const planMetaSchema = z.object({
  ranker_version: z.string().min(1),
  config_hash: z.string().min(1),
  N: z.number().int().nonnegative(),
  qNew: z.number().int().nonnegative(),
  qOld: z.number().int().nonnegative(),
  misReserve: z.number().int().nonnegative(),
  backlog: z.boolean(),
  avg_cost_sec: z.number().positive(),
  exam_ids: z.array(z.uuid()),
  built_at: z.iso.datetime(),
  extensions: z.array(
    z.object({
      at: z.iso.datetime(),
      N: z.number().int().nonnegative(),
      added: z.number().int().nonnegative(),
      backlog: z.boolean(),
      /** The exams active when this extension was built. */
      exam_ids: z.array(z.uuid()).optional(),
    }),
  ),
});

export type PlanEntry = z.infer<typeof planEntrySchema>;
export type PlanMeta = z.infer<typeof planMetaSchema>;

/** A config's identity for session meta: SHA-256 of its JSON with sorted keys, 16 hex digits. */
export function configHash(cfg: QueueConfig): string {
  return createHash("sha256").update(stableJson(cfg)).digest("hex").slice(0, 16);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** What one plan (the day's first, or an extension) is built from. Everything is passed in. */
export interface PlanInput {
  /** The old pool: seen, live, servable cards due today or with an open misconception. */
  old: readonly Candidate[];
  /** The new pool: never-reviewed, live, servable items, at most cfg.newPoolLimit. */
  fresh: readonly Candidate[];
  /** Seen, servable cards not due today: the exam-due pool is taken from them (07 §4.2). */
  notDue?: readonly Candidate[];
  /** The exams after `now` (07 §4.3); none means exam_term = 0 everywhere. */
  exams?: readonly ActiveExam[];
  /** Every seen, live, readable card of any type: the input of topic weakness (QD-10). */
  seen: readonly Candidate[];
  now: Date;
  /** The start of the user's next local day. */
  cutoff: Date;
  registry: SchedulerRegistry;
  budgetSec: number;
  /** Item types of the user's newest solo reviews, at most cfg.costWindow. */
  recentTypes: readonly ItemType[];
  /** The user's latency median per item type; missing or null uses the prior. */
  mediansMs: Partial<Record<ItemType, number | null>>;
  soloReviewCount: number;
  /** 0 for the day's first plan, k for the k-th extension, which lifts the new-item cap. */
  ext: number;
  /** Items that may not be planned: those already in today's plan, for an extension. */
  exclude?: ReadonlySet<string>;
  /** The topic of the plan's last entry, so an extension continues the interleaving. */
  lastTopic?: string | null;
}

/** The numbers a plan was built from; they go into meta. */
export interface PlanNumbers {
  N: number;
  qNew: number;
  qOld: number;
  misReserve: number;
  backlog: boolean;
  avgCostSec: number;
  /** The ids of the exams the plan was built for, sorted. */
  examIds: string[];
}

/**
 * The exam-due pool (07 §4.2, ER3.3): the cards of `input.notDue` in the scope of an exam after
 * now whose recall now is below that exam's target. Empty at the default target 0.9. Pure.
 */
export function examDuePool(
  input: Pick<PlanInput, "notDue" | "exams" | "now" | "registry">,
): Candidate[] {
  const exams = input.exams ?? [];
  if (exams.length === 0) return [];
  return (input.notDue ?? []).filter((candidate) =>
    isExamDue(candidate, exams, input.now, input.registry),
  );
}

/**
 * The pure pipeline of 06-queue-ranker.md §1: features → priority → rank → slots → select → trim →
 * interleave, turned into plan entries. Same input, same output (QA4). With exams (07 §4): the
 * exam-due pool joins the old pool, every candidate gets its exam term, and new items an exam
 * covers are taken before the others (EM-9).
 */
export function planFor(
  input: PlanInput,
  cfg: QueueConfig,
): { entries: PlanEntry[]; numbers: PlanNumbers } {
  const exams = input.exams ?? [];
  const examDue = examDuePool(input);
  const examDueIds = new Set(examDue.map((candidate) => candidate.itemId));
  const old = [...input.old.filter((candidate) => !examDueIds.has(candidate.itemId)), ...examDue];
  const refs = new Map<string, ExamTerm>();
  const ctx: FeatureContext = {
    now: input.now,
    cutoff: input.cutoff,
    registry: input.registry,
    weaknessByTopic: topicWeakness(input.seen, input.now, input.registry),
    overdueCap: cfg.overdueCap,
    stabilityFloorDays: cfg.stabilityFloorDays,
  };
  const ranked = (pool: readonly Candidate[]): Ranked[] =>
    rank(
      pool
        .filter((candidate) => !input.exclude?.has(candidate.itemId))
        .map((candidate) => {
          const stabilityDays = stabilityOf(candidate.card, input.registry);
          const ref = examTermFor(candidate, exams, input.now, input.registry, cfg.exam);
          if (ref !== null) refs.set(candidate.itemId, ref);
          const features = extractFeatures(candidate, ctx, stabilityDays, ref?.term ?? 0);
          return { ...candidate, features, priority: score(features, cfg.weights), stabilityDays };
        }),
    );
  // New items an exam covers come first whatever their priority; the cap still applies (EM-9).
  const examFirst = (items: Ranked[]): Ranked[] =>
    [...items].sort(
      (a, b) => Number(b.features.exam > 0) - Number(a.features.exam > 0) || byRank(a, b),
    );

  const model = costModel(input.mediansMs, cfg);
  const avgCost = avgCostSec(input.recentTypes, model, cfg);
  const N = slotsFor(input.budgetSec, avgCost);
  const selection = select({
    old: ranked(old),
    fresh: examFirst(ranked(input.fresh)),
    N,
    liftNewCap: input.ext > 0 || input.soloReviewCount < cfg.coldStartReviews,
    cfg,
  });
  const kept = trim(selection.picked, model, input.budgetSec, cfg.trimSlack);
  const ordered = interleave(rank(kept), input.lastTopic ?? null);

  return {
    entries: ordered.map((item): PlanEntry => {
      const ref = refs.get(item.itemId);
      return {
        item_id: item.itemId,
        category: categoryOf(item),
        topic_key: item.topicKey,
        priority: item.priority,
        features: item.features,
        cost_sec: model[item.type],
        ext: input.ext,
        ...(examDueIds.has(item.itemId) && { exam_due: true as const }),
        ...(ref !== undefined && {
          exam_ref: { exam_id: ref.exam.id, exam_date: ref.exam.examDate, r_exam: ref.rExam },
        }),
      };
    }),
    numbers: {
      N,
      qNew: selection.qNew,
      qOld: selection.qOld,
      misReserve: selection.misReserve,
      backlog: selection.backlog,
      avgCostSec: avgCost,
      examIds: exams.map((exam) => exam.id).sort(),
    },
  };
}

/** Why the item is in the plan: never reviewed, an open misconception, or a due review. */
function categoryOf(item: Ranked): ReviewCategory {
  if (item.card === null) return "new";
  return item.features.mis === 1 ? "misconception" : "review";
}

/** The meta of a day's first plan. */
export function planMeta(numbers: PlanNumbers, cfg: QueueConfig, builtAt: Date): PlanMeta {
  return {
    ranker_version: cfg.rankerVersion,
    config_hash: configHash(cfg),
    N: numbers.N,
    qNew: numbers.qNew,
    qOld: numbers.qOld,
    misReserve: numbers.misReserve,
    backlog: numbers.backlog,
    avg_cost_sec: numbers.avgCostSec,
    exam_ids: numbers.examIds,
    built_at: builtAt.toISOString(),
    extensions: [],
  };
}
