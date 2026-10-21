import {
  type Citation,
  mcqOptionSchema,
  type ReviewAnswerResponse,
  reviewAnswerRequestSchema,
  reviewAnswerResponseSchema,
  reviewResponseSchema,
} from "@repo/contracts";
import { daysBetween } from "@repo/scheduler";
import { ReviewError } from "../errors";
import { type RecordReviewDeps, recordReview } from "../record/recordReview";
import { verifyPresentationToken } from "../record/token";

/** Longer than this, the tab was left open; latencies are clamped to [0, this] (05 §10). */
const MAX_LATENCY_MS = 600_000;
const SNIPPET_LENGTH = 300;

export interface AnswerDeps extends RecordReviewDeps {
  /** REVIEW_TOKEN_SECRET. */
  tokenSecret: string;
}

/**
 * POST /api/review/answer: checks the presentation token, records the answer through
 * recordReview(), and builds the reveal (correct answer, citation, misconception).
 */
export async function answerReview(
  userId: string,
  body: unknown,
  deps: AnswerDeps,
): Promise<ReviewAnswerResponse> {
  const request = reviewAnswerRequestSchema.safeParse(body);
  if (!request.success) throw new ReviewError("invalid_request", "the body is not a valid answer");

  const now = deps.clock.now();
  const verified = await verifyPresentationToken(
    request.data.presentation_token,
    deps.tokenSecret,
    now,
  );
  if (!verified.ok) {
    throw new ReviewError("invalid_token", `the presentation token is ${verified.reason}`);
  }
  const { presentation } = verified;
  if (presentation.userId !== userId) {
    throw new ReviewError("invalid_token", "the presentation token was issued to another user");
  }

  // The client measures latency; the server's own time since presentation caps it (05 §4).
  const serverElapsedMs = now.getTime() - presentation.presentedAt.getTime();
  const latencyMs = Math.min(
    MAX_LATENCY_MS,
    Math.max(0, Math.min(request.data.client_latency_ms, serverElapsedMs)),
  );

  const outcome = await recordReview(
    {
      reviewId: presentation.reviewId,
      userId,
      itemId: presentation.itemId,
      context: "solo",
      confidence: request.data.confidence,
      response: request.data.response,
      latencyMs,
    },
    deps,
  );

  const [item, logged] = await Promise.all([
    deps.db.item.findUniqueOrThrow({
      where: { id: outcome.itemId },
      select: {
        answer: true,
        options: true,
        sourceChunk: {
          select: {
            id: true,
            blockIds: true,
            pageStart: true,
            text: true,
            source: { select: { id: true, kind: true, title: true } },
          },
        },
      },
    }),
    // On a replay this is the first answer, which is the one the result describes.
    deps.db.reviewLog.findUniqueOrThrow({
      where: { id: outcome.reviewId },
      select: { response: true },
    }),
  ]);
  const citation = citationFor(item.sourceChunk);

  return reviewAnswerResponseSchema.parse({
    status: "graded",
    result: {
      review_id: outcome.reviewId,
      item_id: outcome.itemId,
      correct: outcome.correct,
      correct_answer: item.answer,
      citation,
      grade: outcome.grade,
      retrievability_before: outcome.retrievabilityBefore,
      next_due_at: outcome.nextDueAt.toISOString(),
      scheduled_days: Math.max(0, Math.round(daysBetween(outcome.nextDueAt, now))),
      ...(outcome.misconception && {
        misconception: {
          your_answer: answerText(logged.response, item.options),
          correct_answer: item.answer,
          citation,
        },
      }),
      idempotent_replay: outcome.idempotentReplay,
    },
  });
}

interface ChunkWithSource {
  id: string;
  blockIds: string[];
  pageStart: number | null;
  text: string;
  source: { id: string; kind: "note" | "pdf"; title: string };
}

function citationFor(chunk: ChunkWithSource): Citation {
  const { source } = chunk;
  const firstBlock = chunk.blockIds[0];
  return {
    chunk_id: chunk.id,
    source_id: source.id,
    source_kind: source.kind,
    title: source.title,
    ...(source.kind === "pdf" && chunk.pageStart !== null && { page: chunk.pageStart }),
    ...(source.kind === "note" && firstBlock !== undefined && { block_id: firstBlock }),
    snippet:
      chunk.text.length > SNIPPET_LENGTH
        ? `${chunk.text.slice(0, SNIPPET_LENGTH - 1)}…`
        : chunk.text,
  };
}

/** What the student answered, in words: the chosen option's text, or what they typed. */
function answerText(storedResponse: unknown, storedOptions: unknown): string {
  const response = reviewResponseSchema.parse(storedResponse);
  if (response.kind === "text") return response.text;
  const option = mcqOptionSchema
    .array()
    .parse(storedOptions)
    .find((candidate) => candidate.id === response.option_id);
  return option?.text ?? response.option_id;
}
