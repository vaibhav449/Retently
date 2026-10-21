import {
  answerReview,
  createDefaultRegistry,
  DEFAULT_GRADING,
  REVIEW_ERROR_STATUS,
  ReviewError,
  systemClock,
} from "@repo/revision";
import { getDb } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
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

  try {
    const result = await answerReview(session.user.id, body, {
      db: getDb(),
      clock: systemClock,
      registry: createDefaultRegistry(),
      grading: DEFAULT_GRADING,
      tokenSecret: getServerEnv().REVIEW_TOKEN_SECRET,
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ReviewError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: REVIEW_ERROR_STATUS[error.code] },
      );
    }
    throw error;
  }
}
