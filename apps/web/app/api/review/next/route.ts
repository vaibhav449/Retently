import { presentNext } from "@repo/revision";
import { getServerEnv } from "@/lib/env";
import { reviewHeaders, sessionDeps } from "@/lib/review-engine";
import { getSession } from "@/lib/session";

/**
 * The next question of today's plan, with a presentation token to send back with the answer. The
 * first call of the local day builds the plan (06-queue-ranker.md §8).
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to review" }, { status: 401 });
  }

  const { deps, shifted } = sessionDeps(request);
  const body = await presentNext(session.user.id, {
    ...deps,
    tokenSecret: getServerEnv().REVIEW_TOKEN_SECRET,
  });
  return Response.json(body, { headers: reviewHeaders(shifted) });
}
