import type { IngestRequestedJob } from "@repo/contracts";
import type { UserEvent } from "@repo/messaging";

/** What ingestSource() reports (seam 2 of the weekend plan; packages/ingest owns it). */
export interface IngestResult {
  chunks: number;
  itemsCreated: number;
  itemsSkipped: number;
  budgetExhausted: boolean;
}

export interface IngestDeps {
  /** The source's owner, or null when the source was deleted after the job was published. */
  ownerOf(sourceId: string): Promise<string | null>;
  /** Idempotent: a second run on the same source creates nothing new. */
  ingestSource(sourceId: string): Promise<IngestResult>;
  publishEvent(userId: string, event: UserEvent): Promise<void>;
}

/** Shown to the student when ingestion gives up; the details stay in the parking lot. */
export const INGEST_FAILED_MESSAGE =
  "Questions could not be generated from this source. Try again later.";

/**
 * The `ingest.requested` handlers for startConsumer(). If the worker dies after ingesting but
 * before the ack, the job comes back: ingestSource() then finds nothing new to create, and the
 * owner may get ingest.completed twice, which a notification can afford.
 */
export function ingestHandlers(deps: IngestDeps) {
  return {
    handle: async (job: IngestRequestedJob): Promise<void> => {
      const owner = await deps.ownerOf(job.source_id);
      if (owner === null) {
        console.log(`ingest: source ${job.source_id} no longer exists, nothing to do`);
        return;
      }
      const result = await deps.ingestSource(job.source_id);
      await deps.publishEvent(owner, {
        type: "ingest.completed",
        payload: { source_id: job.source_id, items_created: result.itemsCreated },
      });
    },

    onGaveUp: async (job: IngestRequestedJob): Promise<void> => {
      const owner = await deps.ownerOf(job.source_id);
      if (owner === null) return;
      await deps.publishEvent(owner, {
        type: "ingest.failed",
        payload: { source_id: job.source_id, error: INGEST_FAILED_MESSAGE },
      });
    },
  };
}
