import { sessionView } from "@repo/revision";
import { reviewHeaders, sessionDeps } from "@/lib/review-engine";
import { getSession } from "@/lib/session";

/**
 * Today's review session: created with its plan on the first call of the local day, then returned
 * with fresh progress (06-queue-ranker.md §8).
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to review" }, { status: 401 });
  }

  const { deps, shifted } = sessionDeps(request);
  const view = await sessionView(session.user.id, deps);
  return Response.json(view, { headers: reviewHeaders(shifted) });
}
