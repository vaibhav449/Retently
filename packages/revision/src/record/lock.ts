import type { Database } from "@repo/db";

/**
 * One writer at a time per card (user, item): recordReview() and rebuildCardState() both take
 * this lock before they read or write the card. A row lock can't do this: before the first
 * review there is no card_state row to lock. Released when the surrounding transaction ends.
 */
export async function lockCard(
  tx: Pick<Database, "$executeRaw">,
  userId: string,
  itemId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${itemId}`}))`;
}
