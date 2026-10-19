import { errors, jwtVerify, SignJWT } from "jose";

/**
 * Short-lived pass that lets a logged-in browser open a socket on `realtime`.
 * `web` signs it (it can read the session); `realtime` only verifies it.
 * The token is checked once, when the socket opens, so a short lifetime is enough.
 */

export const REALTIME_TOKEN_TTL_SECONDS = 5 * 60;

const ISSUER = "retently-web";
const AUDIENCE = "retently-realtime";
const ALGORITHM = "HS256";
const MIN_SECRET_LENGTH = 32;

export interface RealtimeTokenClaims {
  userId: string;
}

export type VerifyResult =
  { ok: true; claims: RealtimeTokenClaims } | { ok: false; reason: "expired" | "invalid" };

function secretKey(secret: string): Uint8Array {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`REALTIME_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return new TextEncoder().encode(secret);
}

export async function signRealtimeToken(
  claims: RealtimeTokenClaims,
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + REALTIME_TOKEN_TTL_SECONDS)
    .sign(secretKey(secret));
}

/** Never throws for a bad token; callers close the socket on `ok: false`. */
export async function verifyRealtimeToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      // Pinning the algorithm blocks "alg: none" and algorithm-swap attacks.
      algorithms: [ALGORITHM],
      currentDate: now,
    });
    if (!payload.sub) return { ok: false, reason: "invalid" };
    return { ok: true, claims: { userId: payload.sub } };
  } catch (error) {
    if (error instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
    if (error instanceof errors.JOSEError) return { ok: false, reason: "invalid" };
    throw error;
  }
}
