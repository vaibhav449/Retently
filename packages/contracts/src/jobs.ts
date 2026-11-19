import { z } from "zod";
import { wsEnvelopeSchema } from "./ws";

/**
 * Messages on RabbitMQ (build-plan.md §5). Jobs are commands on the `jobs` exchange, routed by
 * their `type`. Events go to the `events` exchange with routing key `user.<id>`, and realtime
 * forwards them unchanged to that user's /events socket, so every event is a WebSocket envelope.
 *
 * Jobs are thin on purpose: they carry ids, and the worker reads everything else from the
 * database when it runs (a claim check), so a queued message never holds a stale copy of a note.
 */

/**
 * Ingest a source again: published when the student clicks "Generate questions" (and, later,
 * when a note changes or a PDF is uploaded). One run makes questions for a bounded number of
 * passages; while some are still pending, the worker publishes the same job again with `run + 1`.
 */
export const ingestRequestedJobSchema = z.strictObject({
  type: z.literal("ingest.requested"),
  /** The message format. A breaking change ships as `v: 2` while consumers still accept 1. */
  v: z.literal(1),
  source_id: z.uuid(),
  /** `documents.version` when the job was published, so a late, older job can be recognised. */
  version: z.number().int().nonnegative(),
  /** Which run of one click this is: absent or 1 for the click, 2+ for the worker's follow-ups. */
  run: z.number().int().min(1).optional(),
  /** When the student clicked. The final event counts the questions made since then. */
  requested_at: z.iso.datetime().optional(),
});

/**
 * Sent to the source's owner once per click, when the last run of it has finished. Runs before
 * the last one send nothing. The optional fields are absent from workers older than Phase 2.
 */
export const ingestCompletedEventSchema = wsEnvelopeSchema.extend({
  type: z.literal("ingest.completed"),
  payload: z.strictObject({
    source_id: z.uuid(),
    /** New questions since the click, across every run of it. */
    items_created: z.number().int().nonnegative(),
    /** Passages in the note long enough to ask about. */
    chunks: z.number().int().nonnegative().optional(),
    /** Passages still without a question when the work stopped. */
    chunks_pending: z.number().int().nonnegative().optional(),
    /** The owner's daily LLM budget ran out. */
    budget_exhausted: z.boolean().optional(),
  }),
});

/** Sent to the source's owner when ingestion gave up after its retries. */
export const ingestFailedEventSchema = wsEnvelopeSchema.extend({
  type: z.literal("ingest.failed"),
  payload: z.strictObject({
    source_id: z.uuid(),
    /** Short, and safe to show to the student. */
    error: z.string().min(1),
  }),
});

export type IngestRequestedJob = z.infer<typeof ingestRequestedJobSchema>;
export type IngestCompletedEvent = z.infer<typeof ingestCompletedEventSchema>;
export type IngestCompletedPayload = IngestCompletedEvent["payload"];
export type IngestFailedEvent = z.infer<typeof ingestFailedEventSchema>;
