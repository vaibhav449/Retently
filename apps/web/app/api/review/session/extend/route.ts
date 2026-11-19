import { extendSession } from "@repo/revision";
import { reviewHeaders, sessionDeps } from "@/lib/review-engine";
import { getSession } from "@/lib/session";

/**
 * "Study more": adds up to another budget's worth of items not yet in today's plan, the new-item
 * cap lifted (06-queue-ranker.md §8). With nothing left to add, the session comes back unchanged.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to review" }, { status: 401 });
  }

  const { deps, shifted } = sessionDeps(request);
  const view = await extendSession(session.user.id, deps);
  return Response.json(view, { headers: reviewHeaders(shifted) });
}
