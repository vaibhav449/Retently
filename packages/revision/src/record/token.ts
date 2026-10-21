import { errors, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

/**
 * The presentation token (05-review-pipeline.md §2.2): `next` signs one per presented item and
 * `answer` verifies it. It ties the answer to the user, item and moment it was shown, and its review
 * id becomes review_log.id, so a retried submit hits the same row. Its payload is readable; it holds
 * no answer.
 */

/** How long after presentation the answer is still accepted. */
export const PRESENTATION_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

const ISSUER = "retently-web";
// Not the realtime token's audience, so neither token is accepted in the other's place.
const AUDIENCE = "retently-review";
const ALGORITHM = "HS256";
const MIN_SECRET_LENGTH = 32;

/** One item presented to one user. */
export interface Presentation {
  /** uuid v7, minted at presentation. Becomes review_log.id. */
  reviewId: string;
  userId: string;
  itemId: string;
  /** Today's review session; null until sessions exist (Phase 3). */
  sessionId: string | null;
  presentedAt: Date;
}

export type PresentationVerifyResult =
  { ok: true; presentation: Presentation } | { ok: false; reason: "expired" | "invalid" };

const claimsSchema = z.object({
  jti: z.uuid(),
  sub: z.string().min(1),
  iid: z.uuid(),
  sid: z.uuid().nullable(),
  t0: z.number().int().nonnegative(),
});

function secretKey(secret: string): Uint8Array {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`REVIEW_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return new TextEncoder().encode(secret);
}

export async function signPresentationToken(
  presentation: Presentation,
  secret: string,
): Promise<string> {
  const t0 = presentation.presentedAt.getTime();
  return new SignJWT({ iid: presentation.itemId, sid: presentation.sessionId, t0 })
    .setProtectedHeader({ alg: ALGORITHM })
    .setJti(presentation.reviewId)
    .setSubject(presentation.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(t0 / 1000))
    .setExpirationTime(Math.floor((t0 + PRESENTATION_TOKEN_TTL_MS) / 1000))
    .sign(secretKey(secret));
}

/** Never throws for a bad token; the answer route returns 400 on `ok: false`. */
export async function verifyPresentationToken(
  token: string,
  secret: string,
  now: Date,
): Promise<PresentationVerifyResult> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
      currentDate: now,
    });
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return { ok: false, reason: "invalid" };
    const { jti, sub, iid, sid, t0 } = claims.data;
    return {
      ok: true,
      presentation: {
        reviewId: jti,
        userId: sub,
        itemId: iid,
        sessionId: sid,
        presentedAt: new Date(t0),
      },
    };
  } catch (error) {
    if (error instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
    if (error instanceof errors.JOSEError) return { ok: false, reason: "invalid" };
    throw error;
  }
}
