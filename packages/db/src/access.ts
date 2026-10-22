import type { Prisma } from "./generated/prisma/client";
import type { Database } from "./index";

/**
 * Who may read a source, and so its chunks, items and citations. Every read path asks this one
 * place: owner-only for now; Phase 2 adds shared documents (document_access) here.
 */
export async function canAccessSource(
  db: Database,
  userId: string,
  sourceId: string,
): Promise<boolean> {
  const source = await db.source.findUnique({ where: { id: sourceId }, select: { ownerId: true } });
  return source?.ownerId === userId;
}

/**
 * The same rule as a filter on items, for queries that list a user's items (their "bank").
 * Change it together with canAccessSource().
 */
export function itemsReadableBy(userId: string) {
  return { sourceChunk: { source: { ownerId: userId } } } satisfies Prisma.ItemWhereInput;
}
