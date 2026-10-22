import type { Confidence, ReviewContext, ReviewResponse } from "@repo/contracts";
import { canAccessSource, type Database } from "@repo/db";
import {
  type CardState,
  cardStateSchema,
  daysBetween,
  type Grade,
  type SchedulerRegistry,
} from "@repo/scheduler";
import { ReviewError } from "../errors";
import { gradeLocally } from "../grading/gradeResponse";
import { type GradingConfig, mapGrade } from "../grading/mapping";

/** A second solo answer to the same item within this window is a duplicate (two tabs). */
const DUPLICATE_WINDOW_MS = 30_000;

/** The engine never reads the wall clock itself, so replays and simulated students can run it. */
export interface Clock {
  now(): Date;
}

export interface RecordReviewInput {
  /** From the presentation token (solo) or minted by the duel server. Becomes review_log.id. */
  reviewId: string;
  userId: string;
  itemId: string;
  context: ReviewContext;
  /** Null only for duel answers. */
  confidence: Confidence | null;
  response: ReviewResponse;
  /** Already clamped by the caller. */
  latencyMs: number;
}

export interface RecordReviewDeps {
  db: Database;
  clock: Clock;
  registry: SchedulerRegistry;
  grading: GradingConfig;
}

export interface ReviewOutcome {
  reviewId: string;
  itemId: string;
  correct: boolean;
  grade: Grade;
  misconception: boolean;
  /** Probability of recall just before this answer; null on a first review and on a replay. */
  retrievabilityBefore: number | null;
  nextDueAt: Date;
  /** This presentation was answered before: the first result is returned and nothing is written. */
  idempotentReplay: boolean;
}

/**
 * The only way an answer is recorded (05-review-pipeline.md §7). Grades it, advances the card with
 * the scheduler that wrote its state, and writes review_log and card_state in one transaction.
 */
export async function recordReview(
  input: RecordReviewInput,
  deps: RecordReviewDeps,
): Promise<ReviewOutcome> {
  const now = deps.clock.now();
  const item = await loadReviewableItem(deps.db, input.userId, input.itemId);
  // Graded before the transaction, so a bad answer is refused without taking the lock.
  const correct = gradeLocally(item, input.response);
  const card = { userId: input.userId, itemId: input.itemId };

  return deps.db.$transaction(async (tx) => {
    // One answer at a time per (user, item). A row lock can't do this: before the first review
    // there is no card_state row to lock. Released when the transaction ends.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.userId}:${input.itemId}`}))`;

    const prior = await tx.reviewLog.findUnique({ where: { id: input.reviewId } });
    if (prior) {
      if (prior.userId !== input.userId || prior.itemId !== input.itemId) {
        throw new ReviewError(
          "review_id_conflict",
          `review ${input.reviewId} belongs to another answer`,
        );
      }
      const current = await tx.cardState.findUniqueOrThrow({ where: { userId_itemId: card } });
      return {
        reviewId: prior.id,
        itemId: prior.itemId,
        correct: prior.correct,
        grade: asGrade(prior.grade),
        misconception: prior.context === "solo" && prior.confidence === "sure" && !prior.correct,
        retrievabilityBefore: null,
        nextDueAt: current.dueAt,
        idempotentReplay: true,
      };
    }

    if (input.context === "solo") {
      const recent = await tx.reviewLog.findFirst({
        where: {
          ...card,
          context: "solo",
          reviewedAt: { gt: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (recent) {
        throw new ReviewError(
          "duplicate_answer",
          "this item was answered less than 30 seconds ago",
        );
      }
    }

    const stored = await tx.cardState.findUnique({ where: { userId_itemId: card } });
    // A stored state is advanced only by the scheduler that wrote it; new cards get the active one.
    const scheduler = stored ? deps.registry.get(stored.schedulerVersion) : deps.registry.active;
    const state: CardState = stored ? cardStateSchema.parse(stored.state) : scheduler.initial();
    const lastReviewAt = state.last_review_at === null ? null : new Date(state.last_review_at);

    // Latency medians arrive in Phase 3; until then a confident correct answer is Good, never Easy.
    const { grade, misconception } = mapGrade(
      {
        context: input.context,
        confidence: input.confidence,
        correct,
        latencyMs: input.latencyMs,
        medianMs: null,
      },
      deps.grading,
    );
    const retrievabilityBefore =
      lastReviewAt === null ? null : scheduler.retrievability(state, now);
    const next = scheduler.next(state, grade, now);

    await tx.reviewLog.create({
      data: {
        id: input.reviewId,
        ...card,
        reviewedAt: now,
        grade,
        confidence: input.confidence,
        correct,
        response: { ...input.response },
        latencyMs: input.latencyMs,
        elapsedDays: lastReviewAt === null ? null : daysBetween(now, lastReviewAt),
        context: input.context,
        schedulerVersion: scheduler.version,
      },
    });

    const nextDueAt = dueDateOf(next, scheduler.version);
    const written = {
      schedulerVersion: scheduler.version,
      state: { ...next },
      dueAt: nextDueAt,
      // The misconception override (retest from the next local day) arrives in Phase 3.
      misconceptionUntil: null,
      updatedAt: now,
    };
    await tx.cardState.upsert({
      where: { userId_itemId: card },
      create: { ...card, ...written },
      update: written,
    });

    return {
      reviewId: input.reviewId,
      itemId: input.itemId,
      correct,
      grade,
      misconception,
      retrievabilityBefore,
      nextDueAt,
      idempotentReplay: false,
    };
  });
}

async function loadReviewableItem(db: Database, userId: string, itemId: string) {
  const item = await db.item.findUnique({
    where: { id: itemId },
    select: {
      type: true,
      options: true,
      answerOptionId: true,
      retiredAt: true,
      sourceChunk: { select: { sourceId: true } },
    },
  });
  if (!item) throw new ReviewError("item_not_found", `item ${itemId} does not exist`);
  if (!(await canAccessSource(db, userId, item.sourceChunk.sourceId))) {
    throw new ReviewError("forbidden", `user ${userId} cannot read item ${itemId}`);
  }
  if (item.retiredAt) throw new ReviewError("item_retired", `item ${itemId} was retired`);
  return item;
}

function dueDateOf(state: CardState, version: string): Date {
  if (state.due_at === null) throw new Error(`${version} returned a state without due_at`);
  return new Date(state.due_at);
}

function asGrade(value: number): Grade {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  throw new Error(`review_log.grade ${value} is outside 1-4`);
}
