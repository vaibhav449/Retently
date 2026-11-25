import { type Database, syntheticUsers } from "@repo/db";

/**
 * Removes every synthetic user (packages/db syntheticUsers(): the reserved email domain) and, by
 * the foreign keys' ON DELETE CASCADE, everything they own: notes, sources, chunks, items,
 * review_log, card_state, sessions, exams, settings, auth sessions and accounts. Nobody else's
 * rows: a real user can only read their own notes, so nothing of theirs refers to these. Returns
 * how many users were removed.
 */
export async function deleteSyntheticUsers(db: Database): Promise<number> {
  const { count } = await db.user.deleteMany({ where: syntheticUsers() });
  return count;
}
