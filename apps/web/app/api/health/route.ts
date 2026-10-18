import type { HealthResponse } from "@repo/contracts";
import { connection } from "next/server";

export async function GET() {
  // Without this, Cache Components would prerender the response once at build time.
  await connection();

  const body: HealthResponse = {
    status: "ok",
    service: "web",
    uptimeSeconds: Math.floor(process.uptime()),
  };
  return Response.json(body);
}
