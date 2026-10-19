import { z } from "zod";

/**
 * Where a piece of content came from. Every screen that shows a source renders this shape:
 * an item's reveal, a misconception, a chat answer (build-plan.md §7.2).
 */
export const citationSchema = z.object({
  chunk_id: z.uuid(),
  source_id: z.uuid(),
  source_kind: z.enum(["note", "pdf"]),
  title: z.string().min(1),
  /** PDF sources only. */
  page: z.number().int().positive().optional(),
  /** Note sources only: the editor block to scroll to. */
  block_id: z.string().min(1).optional(),
  snippet: z.string().min(1),
});

export type Citation = z.infer<typeof citationSchema>;
