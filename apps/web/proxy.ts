import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PAGES = ["/login", "/signup"];

/**
 * Optimistic check only: is there a session cookie at all? It saves a round trip
 * for logged-out visitors but proves nothing, since anyone can set a cookie.
 * Pages and API routes still verify the session themselves (lib/session.ts).
 */
export function proxy(request: NextRequest) {
  if (PUBLIC_PAGES.includes(request.nextUrl.pathname)) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // API routes answer 401 themselves instead of redirecting; static files need no session.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
