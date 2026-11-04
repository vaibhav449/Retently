import { z } from "zod";

/** A note's title: trimmed and never empty. */
export const documentTitleSchema = z.string().trim().min(1).max(200);

/** Generous for a study note; keeps one autosave body well under a megabyte. */
export const DOCUMENT_MARKDOWN_MAX = 200_000;

/** POST /api/documents. */
export const createDocumentResponseSchema = z.strictObject({
  id: z.uuid(),
});

/** PATCH /api/documents/:id with a title: renames the note. */
export const renameDocumentRequestSchema = z.strictObject({
  title: documentTitleSchema,
});

export const renameDocumentResponseSchema = z.strictObject({
  id: z.uuid(),
  title: documentTitleSchema,
});

/**
 * PATCH /api/documents/:id with content: one autosave. `base_version` is the version the editor
 * last saved; the server refuses the save with 409 if the note has moved on since (another tab).
 */
export const saveDocumentContentRequestSchema = z.strictObject({
  /** TipTap JSON. The editor owns its shape; temporary until Yjs replaces it in Phase 2. */
  content_json: z
    .record(z.string(), z.json())
    .refine((json) => json.type === "doc", { message: "content_json must be a TipTap doc" }),
  /** The same content as Markdown. Ingestion reads only this. */
  content_md: z.string().max(DOCUMENT_MARKDOWN_MAX),
  base_version: z.number().int().nonnegative(),
});

export const saveDocumentContentResponseSchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
});

/** 409 from a save: the version the note is at now. */
export const documentVersionConflictSchema = z.strictObject({
  error: z.literal("version_conflict"),
  version: z.number().int().nonnegative(),
});

/** PATCH /api/documents/:id: either a rename or a save, never both. */
export const updateDocumentRequestSchema = z.union([
  renameDocumentRequestSchema,
  saveDocumentContentRequestSchema,
]);

export type CreateDocumentResponse = z.infer<typeof createDocumentResponseSchema>;
export type RenameDocumentRequest = z.infer<typeof renameDocumentRequestSchema>;
export type RenameDocumentResponse = z.infer<typeof renameDocumentResponseSchema>;
export type SaveDocumentContentRequest = z.infer<typeof saveDocumentContentRequestSchema>;
export type SaveDocumentContentResponse = z.infer<typeof saveDocumentContentResponseSchema>;
export type DocumentVersionConflict = z.infer<typeof documentVersionConflictSchema>;
export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>;

/** What one "Generate questions" click did: the ingest run's result (seam 2), as sent to the note page. */
export const generateQuestionsResponseSchema = z.strictObject({
  /** Passages in the note long enough to ask about. */
  chunks: z.number().int().nonnegative(),
  items_created: z.number().int().nonnegative(),
  /** Passages that already had a question, so nothing was generated for them. */
  items_skipped: z.number().int().nonnegative(),
  /** The student's daily LLM budget ran out during the run. */
  budget_exhausted: z.boolean(),
  /** Passages still without a question; another click (or tomorrow's budget) picks them up. */
  chunks_pending: z.number().int().nonnegative(),
});

export type GenerateQuestionsResponse = z.infer<typeof generateQuestionsResponseSchema>;
