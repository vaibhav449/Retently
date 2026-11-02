import type { SaveDocumentContentRequest } from "@repo/contracts";
import type { Database } from "@repo/db";
import { z } from "zod";

const UNTITLED = "Untitled";
const documentIdSchema = z.uuid();

/**
 * The one ownership rule for documents: owner-only for now, like canAccessSource(). Phase 2 adds
 * shared documents here. Every function below filters by it, so another user's id behaves exactly
 * like an id that does not exist. An id that is not a uuid matches nothing (Postgres would reject it).
 */
function ownedBy(userId: string, documentId: string) {
  return documentIdSchema.safeParse(documentId).success
    ? { id: documentId, ownerId: userId }
    : null;
}

/** The user's notes, most recently edited first. */
export function listDocuments(db: Database, userId: string) {
  return db.document.findMany({
    where: { ownerId: userId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, title: true, updatedAt: true },
  });
}

/**
 * A new empty note, with its `sources` row created in the same insert, so every note can be
 * ingested without a separate step (kickoff decision K1).
 */
export function createDocument(db: Database, userId: string) {
  return db.document.create({
    data: {
      ownerId: userId,
      title: UNTITLED,
      source: { create: { ownerId: userId, kind: "note", title: UNTITLED } },
    },
    select: { id: true },
  });
}

/** Null when the document does not exist or belongs to someone else. */
export function getDocument(db: Database, userId: string, documentId: string) {
  const where = ownedBy(userId, documentId);
  if (!where) return Promise.resolve(null);
  return db.document.findFirst({
    where,
    select: { id: true, title: true, contentJson: true, contentMd: true, version: true },
  });
}

/** Renames the note and its source together. False when the user does not own it. */
export async function renameDocument(
  db: Database,
  userId: string,
  documentId: string,
  title: string,
): Promise<boolean> {
  const where = ownedBy(userId, documentId);
  if (!where) return false;
  return db.$transaction(async (tx) => {
    const { count } = await tx.document.updateMany({ where, data: { title } });
    if (count === 0) return false;
    await tx.source.updateMany({ where: { documentId }, data: { title } });
    return true;
  });
}

export type SaveContentResult =
  | { status: "saved"; version: number }
  | { status: "conflict"; version: number }
  | { status: "not_found" };

/**
 * One autosave: writes both forms of the content and bumps `version`, but only if the note is
 * still at `baseVersion`. Otherwise another tab saved first and this save would overwrite it.
 */
export async function saveDocumentContent(
  db: Database,
  userId: string,
  documentId: string,
  content: {
    json: SaveDocumentContentRequest["content_json"];
    markdown: string;
    baseVersion: number;
  },
): Promise<SaveContentResult> {
  const where = ownedBy(userId, documentId);
  if (!where) return { status: "not_found" };

  const { count } = await db.document.updateMany({
    where: { ...where, version: content.baseVersion },
    data: {
      contentJson: content.json,
      contentMd: content.markdown,
      version: { increment: 1 },
    },
  });
  if (count === 1) return { status: "saved", version: content.baseVersion + 1 };

  const current = await db.document.findFirst({ where, select: { version: true } });
  return current ? { status: "conflict", version: current.version } : { status: "not_found" };
}

/**
 * Deletes the note. The database cascades to its source, chunks, items and their reviews.
 * False when the user does not own it.
 */
export async function deleteDocument(
  db: Database,
  userId: string,
  documentId: string,
): Promise<boolean> {
  const where = ownedBy(userId, documentId);
  if (!where) return false;
  const { count } = await db.document.deleteMany({ where });
  return count > 0;
}
