import { ingestRequestedJobSchema } from "@repo/contracts";
import type { Database } from "@repo/db";
import { ingestSource } from "@repo/ingest";
import type { LlmDeps } from "@repo/llm";
import { type Consumer, publishEvent, publishJob, QUEUES, startConsumer } from "@repo/messaging";
import type { ConfirmChannel } from "amqplib";
import { ingestHandlers } from "./consumers/ingest";

/** An ingest job is mostly LLM calls: a few at a time is plenty, and fair across workers. */
export const INGEST_PREFETCH = 4;

/** Attempts before a failing ingest job is parked and its owner told. */
export const INGEST_MAX_ATTEMPTS = 3;

export interface WorkerDeps {
  /** A confirm channel, so a follow-up, a retry copy or a parked job is sent only once confirmed. */
  channel: ConfirmChannel;
  db: Database;
  /** The model (defaultModel in production, a mock in tests), the daily budget and the clock. */
  llm: Omit<LlmDeps, "db">;
  /** Tests shrink these; production uses MAX_RUNS_PER_CLICK and MAX_CHUNKS_PER_RUN. */
  maxRuns?: number;
  maxChunksPerRun?: number;
}

/**
 * Starts consuming `ingest` with the production wiring: the real ingestSource(), follow-ups and
 * events on the same channel. The topology must already be asserted.
 */
export function startIngestWorker(deps: WorkerDeps): Promise<Consumer> {
  const { channel, db } = deps;
  const ingest = ingestHandlers({
    ownerOf: async (sourceId) => {
      const source = await db.source.findUnique({
        where: { id: sourceId },
        select: { ownerId: true },
      });
      return source?.ownerId ?? null;
    },
    ingestSource: (sourceId) =>
      ingestSource(sourceId, { db, ...deps.llm, maxChunksPerRun: deps.maxChunksPerRun }),
    itemsCreatedSince: (sourceId, since) =>
      db.item.count({
        where: { retiredAt: null, createdAt: { gte: since }, sourceChunk: { sourceId } },
      }),
    publishJob: (job) => publishJob(channel, job),
    publishEvent: (userId, event) => publishEvent(channel, userId, event),
    maxRuns: deps.maxRuns,
  });
  return startConsumer(channel, {
    queue: QUEUES.ingest,
    schema: ingestRequestedJobSchema,
    prefetch: INGEST_PREFETCH,
    maxAttempts: INGEST_MAX_ATTEMPTS,
    handle: ingest.handle,
    onGaveUp: ingest.onGaveUp,
  });
}
