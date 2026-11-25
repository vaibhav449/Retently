import type { Prisma } from "./generated/prisma/client";

/**
 * The one marker of a synthetic user (eval/synth, 09-evaluation.md §5): an email address on this
 * domain. `.invalid` is reserved by RFC 2606, so no real inbox can have it, and once email
 * verification is on no person can verify such an account.
 */
export const SYNTHETIC_EMAIL_DOMAIN = "synthetic.invalid";

const SUFFIX = `@${SYNTHETIC_EMAIL_DOMAIN}`;

/** True for a synthetic user's email address. The same rule as syntheticUsers(). */
export function isSyntheticEmail(email: string): boolean {
  return email.toLowerCase().endsWith(SUFFIX);
}

/**
 * The synthetic users, as a filter on users. `npm run db:seed -- --reset` deletes exactly these
 * (and, by cascade, everything they own).
 */
export function syntheticUsers() {
  return { email: { endsWith: SUFFIX, mode: "insensitive" } } satisfies Prisma.UserWhereInput;
}

/**
 * Everyone else: the default population of analytics, evaluation and cohort exports, which must
 * leave synthetic students out unless they ask for them. Use it as `where: { user: realUsers() }`
 * on review_log, card_state and the like, or directly on users.
 */
export function realUsers() {
  return { NOT: syntheticUsers() } satisfies Prisma.UserWhereInput;
}
