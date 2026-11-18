import { presentNext } from "@repo/revision";
import { getDb } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { reviewClock, reviewHeaders } from "@/lib/review-engine";
import { getSession } from "@/lib/session";

/** The next question to review, with a presentation token to send back with the answer. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to review" }, { status: 401 });
  }

  const { clock, shifted } = reviewClock(request);
  const body = await presentNext(session.user.id, {
    db: getDb(),
    clock,
    tokenSecret: getServerEnv().REVIEW_TOKEN_SECRET,
  });
  return Response.json(body, { headers: reviewHeaders(shifted) });
}
