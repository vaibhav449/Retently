import {
  mcqOptionSchema,
  type ReviewNextResponse,
  reviewNextResponseSchema,
} from "@repo/contracts";
import { nextInSession, type SessionDeps } from "../queue/session";
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
 * nothing_due. The payload shape is the Phase 1 one.
 */
export async function presentNext(userId: string, deps: PresentDeps): Promise<ReviewNextResponse> {
  const next = await nextInSession(userId, deps);
  if (next.kind === "nothing") return { state: "nothing_due" };
  if (next.kind === "done") return { state: "done_for_today", can_extend: next.canExtend };

  const now = deps.clock.now();
  const item = await deps.db.item.findUniqueOrThrow({
    where: { id: next.entry.item_id },
    select: { id: true, type: true, prompt: true, options: true },
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
      category: next.entry.category,
      item: {
        id: item.id,
        type: item.type,
        prompt: item.prompt,
        options: shuffleBySeed(mcqOptionsSchema.parse(item.options), reviewId),
      },
    },
    progress: next.progress,
  });
}
