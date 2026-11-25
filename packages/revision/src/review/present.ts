import {
  mcqOptionSchema,
  type ReviewNextResponse,
  reviewNextResponseSchema,
} from "@repo/contracts";
import { daysBetween } from "@repo/scheduler";
import { reasonFor } from "../queue/explain";
import { nextInSession, type SessionDeps } from "../queue/session";
import { localDaysBetween } from "../time";
import { signPresentationToken } from "../record/token";
import { uuidv7 } from "../record/uuidv7";
import { shuffleBySeed } from "./shuffle";

export interface PresentDeps extends SessionDeps {
  /** REVIEW_TOKEN_SECRET. */
  tokenSecret: string;
}

const mcqOptionsSchema = mcqOptionSchema.array();

/**
 * GET /api/review/next (06-queue-ranker.md §8): the first open entry of today's plan, which is
 * built on the first call of the local day (QD-2); its category is the plan's (QD-11). When every
 * entry is answered or skipped, done_for_today with can_extend; with nothing at all to plan,
 * nothing_due. Each question carries its "why am I seeing this" line (06 §10, QD-13): the
 * largest contributor to its planned priority, an upcoming exam included (EM-11).
 */
export async function presentNext(userId: string, deps: PresentDeps): Promise<ReviewNextResponse> {
  const next = await nextInSession(userId, deps);
  if (next.kind === "nothing") return { state: "nothing_due" };
  if (next.kind === "done") return { state: "done_for_today", can_extend: next.canExtend };

  const now = deps.clock.now();
  const { entry } = next;
  const item = await deps.db.item.findUniqueOrThrow({
    where: { id: entry.item_id },
    select: {
      id: true,
      type: true,
      prompt: true,
      options: true,
      sourceChunk: { select: { source: { select: { title: true } } } },
      cardStates: { where: { userId }, select: { dueAt: true } },
    },
  });
  const card = item.cardStates[0];
  const reason = reasonFor(entry, {
    weights: deps.queue.weights,
    sourceTitle: item.sourceChunk.source.title,
    ...(card !== undefined && { overdueDays: Math.max(0, daysBetween(now, card.dueAt)) }),
    ...(entry.exam_ref !== undefined && {
      examDays: localDaysBetween(next.localDate, entry.exam_ref.exam_date),
      rExam: entry.exam_ref.r_exam,
    }),
  });
  const reviewId = uuidv7(now);
  const presentationToken = await signPresentationToken(
    { reviewId, userId, itemId: item.id, sessionId: next.sessionId, presentedAt: now },
    deps.tokenSecret,
  );

  // Parsed with the strict contract, so nothing that reveals the answer can reach the client.
  return reviewNextResponseSchema.parse({
    state: "ok",
    item: {
      presentation_token: presentationToken,
      category: entry.category,
      item: {
        id: item.id,
        type: item.type,
        prompt: item.prompt,
        options: shuffleBySeed(mcqOptionsSchema.parse(item.options), reviewId),
      },
    },
    progress: next.progress,
    reason,
  });
}
