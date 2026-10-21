import { presentNext, systemClock } from "@repo/revision";
import { getDb } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { getSession } from "@/lib/session";

/** The next question to review, with a presentation token to send back with the answer. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to review" }, { status: 401 });
  }

  const body = await presentNext(session.user.id, {
    db: getDb(),
    clock: systemClock,
    tokenSecret: getServerEnv().REVIEW_TOKEN_SECRET,
  });
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
