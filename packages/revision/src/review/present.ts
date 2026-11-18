import {
  mcqOptionSchema,
  type ReviewNextResponse,
  reviewNextResponseSchema,
  type SessionProgress,
} from "@repo/contracts";
import { type Database, itemsReadableBy } from "@repo/db";
import { effectiveDueAt } from "../misconception";
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

/** Items this user may be asked now: readable by them, live, and gradable (MCQ only in Phase 1). */
function reviewableBy(userId: string) {
  return {
    ...itemsReadableBy(userId),
    retiredAt: null,
    type: "mcq" as const,
  };
}

interface DueCard {
  itemId: string;
  dueAt: Date;
  misconceptionUntil: Date | null;
}

/** The card that comes first by (effective due date, item id); either may be missing. */
function earlier(a: DueCard | null, b: DueCard | null): DueCard | null {
  if (a === null || b === null) return a ?? b;
  const byDue = effectiveDueAt(a).getTime() - effectiveDueAt(b).getTime();
  if (byDue !== 0) return byDue < 0 ? a : b;
  return a.itemId <= b.itemId ? a : b;
}

/**
 * The user's card with the earliest effective due date (05 §6.2) that is due by `now`, among
 * reviewable items, or null. Two indexed queries, one per column (DD-10): the earliest card
 * overall heads one of them, since min(min due_at, min until) = min over cards of min(due_at,
 * until). Both keep itemsReadableBy as the only definition of access (03 §7.1).
 */
async function earliestDue(db: Database, userId: string, now: Date): Promise<DueCard | null> {
  const item = reviewableBy(userId);
  const select = { itemId: true, dueAt: true, misconceptionUntil: true } as const;
  const [byDueAt, byOverride] = await Promise.all([
    db.cardState.findFirst({
      where: { userId, dueAt: { lte: now }, item },
      orderBy: [{ dueAt: "asc" }, { itemId: "asc" }],
      select,
    }),
    db.cardState.findFirst({
      where: { userId, misconceptionUntil: { lte: now }, item },
      orderBy: [{ misconceptionUntil: "asc" }, { itemId: "asc" }],
      select,
    }),
  ]);
  return earlier(byDueAt, byOverride);
}

/**
 * GET /api/review/next for Phase 1: the user's earliest-due card by effective due date (a passed
 * misconception override counts as due, R4.1), else their oldest new MCQ, else nothing. Daily
 * sessions, budgets and the ranker replace this in Phase 3.
 */
export async function presentNext(userId: string, deps: PresentDeps): Promise<ReviewNextResponse> {
  const now = deps.clock.now();
  const reviewable = reviewableBy(userId);

  const due = await earliestDue(deps.db, userId, now);
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
      // An open misconception, however the card became due (DD-11).
      category: due === null ? "new" : due.misconceptionUntil !== null ? "misconception" : "review",
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
    // Due by effective due date: due_at or a passed misconception override.
    db.cardState.count({
      where: {
        userId,
        OR: [{ dueAt: { lte: now } }, { misconceptionUntil: { lte: now } }],
        item: reviewable,
      },
    }),
    db.item.count({ where: { ...reviewable, cardStates: { none: { userId } } } }),
  ]);
  return { done, planned: done + due + fresh };
}
