import type { RealtimeTokenResponse } from "@repo/contracts";
import { REALTIME_TOKEN_TTL_SECONDS, signRealtimeToken } from "@repo/realtime-token";
import { getServerEnv } from "@/lib/env";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to connect" }, { status: 401 });
  }

  const token = await signRealtimeToken(
    { userId: session.user.id },
    getServerEnv().REALTIME_TOKEN_SECRET,
  );
  const body: RealtimeTokenResponse = { token, expires_in: REALTIME_TOKEN_TTL_SECONDS };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
