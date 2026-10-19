import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";

/**
 * The real session check: looks the cookie's token up in the `sessions` table.
 * proxy.ts only checks that a cookie exists, so every page and route calls this.
 * Reads request headers, so callers must render inside <Suspense>.
 */
export async function getSession() {
  // Read headers before touching auth: it marks the route as request-time, so
  // `next build` stops prerendering here instead of creating auth without secrets.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}
