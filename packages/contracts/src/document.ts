import { z } from "zod";

/** A note's title: trimmed and never empty. */
export const documentTitleSchema = z.string().trim().min(1).max(200);

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

export type CreateDocumentResponse = z.infer<typeof createDocumentResponseSchema>;
export type RenameDocumentRequest = z.infer<typeof renameDocumentRequestSchema>;
export type RenameDocumentResponse = z.infer<typeof renameDocumentResponseSchema>;
