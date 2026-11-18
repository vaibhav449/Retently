import {
  answerReview,
  createDefaultRegistry,
  DEFAULT_GRADING,
  REVIEW_ERROR_STATUS,
  ReviewError,
} from "@repo/revision";
import { getDb } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { latencyMedians, reviewClock, reviewHeaders } from "@/lib/review-engine";
import { getSession } from "@/lib/session";

/** Records an answer to a presented question and returns the reveal. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to review" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_request", message: "The body is not JSON" },
      { status: 400 },
    );
  }

  const { clock, shifted } = reviewClock(request);
  try {
    const result = await answerReview(session.user.id, body, {
      db: getDb(),
      clock,
      registry: createDefaultRegistry(),
      grading: DEFAULT_GRADING,
      medians: latencyMedians(),
      tokenSecret: getServerEnv().REVIEW_TOKEN_SECRET,
    });
    return Response.json(result, { headers: reviewHeaders(shifted) });
  } catch (error) {
    if (error instanceof ReviewError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: REVIEW_ERROR_STATUS[error.code], headers: reviewHeaders(shifted) },
      );
    }
    throw error;
  }
}
