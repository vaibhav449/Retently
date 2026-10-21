import {
  mcqOptionSchema,
  type ReviewNextResponse,
  reviewNextResponseSchema,
  type SessionProgress,
} from "@repo/contracts";
import type { Database } from "@repo/db";
import type { Clock } from "../record/recordReview";
import { signPresentationToken } from "../record/token";
import { uuidv7 } from "../record/uuidv7";
import { shuffleBySeed } from "./shuffle";

export interface PresentDeps {
  db: Database;
  clock: Clock;
  /** REVIEW_TOKEN_SECRET. */
  tokenSecret: string;
}

const mcqOptionsSchema = mcqOptionSchema.array();

/** Items this user may be asked now: their own, live, and gradable (MCQ only in Phase 1). */
function reviewableBy(userId: string) {
  return {
    retiredAt: null,
    type: "mcq" as const,
    sourceChunk: { source: { ownerId: userId } },
  };
}

/**
 * GET /api/review/next for Phase 1: the user's earliest-due card, else their oldest new MCQ, else
 * nothing. Daily sessions, budgets and the ranker replace this in Phase 3.
 */
export async function presentNext(userId: string, deps: PresentDeps): Promise<ReviewNextResponse> {
  const now = deps.clock.now();
  const reviewable = reviewableBy(userId);

  const due = await deps.db.cardState.findFirst({
    where: { userId, dueAt: { lte: now }, item: reviewable },
    orderBy: [{ dueAt: "asc" }, { itemId: "asc" }],
    select: { itemId: true, misconceptionUntil: true },
  });
  const fresh = due
    ? null
    : await deps.db.item.findFirst({
        where: { ...reviewable, cardStates: { none: { userId } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
  const itemId = due?.itemId ?? fresh?.id;
  if (itemId === undefined) return { state: "nothing_due" };

  const item = await deps.db.item.findUniqueOrThrow({
    where: { id: itemId },
    select: { id: true, type: true, prompt: true, options: true },
  });
  const reviewId = uuidv7(now);
  const presentationToken = await signPresentationToken(
    { reviewId, userId, itemId, sessionId: null, presentedAt: now },
    deps.tokenSecret,
  );

  // Parsed with the strict contract, so nothing that reveals the answer can reach the client.
  return reviewNextResponseSchema.parse({
    state: "ok",
    item: {
      presentation_token: presentationToken,
      category: due === null ? "new" : due.misconceptionUntil ? "misconception" : "review",
      item: {
        id: item.id,
        type: item.type,
        prompt: item.prompt,
        options: shuffleBySeed(mcqOptionsSchema.parse(item.options), reviewId),
      },
    },
    progress: await progressToday(deps.db, userId, now),
  });
}

/** Phase 1: "today" is the UTC day, until time zones arrive in Phase 3. */
async function progressToday(db: Database, userId: string, now: Date): Promise<SessionProgress> {
  const reviewable = reviewableBy(userId);
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [done, due, fresh] = await Promise.all([
    db.reviewLog.count({ where: { userId, context: "solo", reviewedAt: { gte: startOfDay } } }),
    db.cardState.count({ where: { userId, dueAt: { lte: now }, item: reviewable } }),
    db.item.count({ where: { ...reviewable, cardStates: { none: { userId } } } }),
  ]);
  return { done, planned: done + due + fresh };
}
