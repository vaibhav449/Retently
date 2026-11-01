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

/** Ingest a source again: published when a note changes or a PDF is uploaded. */
export const ingestRequestedJobSchema = z.strictObject({
  type: z.literal("ingest.requested"),
  /** The message format. A breaking change ships as `v: 2` while consumers still accept 1. */
  v: z.literal(1),
  source_id: z.uuid(),
  /** `documents.version` when the job was published, so a late, older job can be recognised. */
  version: z.number().int().nonnegative(),
});

/** Sent to the source's owner when ingestion has finished. */
export const ingestCompletedEventSchema = wsEnvelopeSchema.extend({
  type: z.literal("ingest.completed"),
  payload: z.strictObject({
    source_id: z.uuid(),
    items_created: z.number().int().nonnegative(),
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
export type IngestFailedEvent = z.infer<typeof ingestFailedEventSchema>;
