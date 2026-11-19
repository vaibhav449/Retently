import type { IngestRequestedJob } from "@repo/contracts";
import { IngestError, type IngestResult } from "@repo/ingest";
import { PermanentError, type UserEvent } from "@repo/messaging";

/**
 * Runs of one click before the worker stops following up: 10 runs of 20 passages is 200
 * passages, more than the default $0.50 daily budget pays for (about 190 calls).
 */
export const MAX_RUNS_PER_CLICK = 10;

export interface IngestDeps {
  /** The source's owner, or null when the source was deleted after the job was published. */
  ownerOf(sourceId: string): Promise<string | null>;
  /**
   * ingestSource() from @repo/ingest with the real deps. Idempotent: a second run on the same
   * source creates nothing new. Throws IngestError for a missing or unsupported source.
   */
  ingestSource(sourceId: string): Promise<IngestResult>;
  /** Live questions of the source created at or after `since`. */
  itemsCreatedSince(sourceId: string, since: Date): Promise<number>;
  /** Publishes a follow-up run and waits for the broker's confirm. */
  publishJob(job: IngestRequestedJob): Promise<void>;
  publishEvent(userId: string, event: UserEvent): Promise<void>;
  /** Defaults to MAX_RUNS_PER_CLICK; tests shrink it. */
  maxRuns?: number;
}

/** Shown to the student when ingestion gives up; the details stay in the parking lot. */
export const INGEST_FAILED_MESSAGE =
  "Questions could not be generated from this source. Try again later.";

/** What to do once a run has finished. */
export type NextStep = { kind: "follow_up"; job: IngestRequestedJob } | { kind: "complete" };

/**
 * After one run: follow up while passages are still pending, the budget lasts, the run made
 * progress (so an unusable model can't loop forever), and the click has runs left. The
 * follow-up is the same job, `run + 1`, so it keeps the click's `requested_at`.
 */
export function nextStep(
  job: IngestRequestedJob,
  result: IngestResult,
  maxRuns: number = MAX_RUNS_PER_CLICK,
): NextStep {
  const run = job.run ?? 1;
  const followUp =
    result.chunksPending > 0 && !result.budgetExhausted && result.itemsCreated > 0 && run < maxRuns;
  return followUp ? { kind: "follow_up", job: { ...job, run: run + 1 } } : { kind: "complete" };
}

/**
 * Runs tasks with the same key one after another, and tasks with different keys side by side.
 * A failed task does not stop the next one.
 */
export function keyedQueue() {
  const tails = new Map<string, Promise<void>>();
  return function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const result = (tails.get(key) ?? Promise.resolve()).then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}

/**
 * The `ingest.requested` handlers for startConsumer().
 *
 * Jobs for one source run one at a time in this worker, so a double click, or a click meeting a
 * follow-up, never pays the model twice for the same passages. A follow-up is confirmed before
 * the job is acked: a crash in between duplicates the chain, which is safe (one item per chunk).
 * Only the last run of a click tells the owner, with the totals since the click.
 */
export function ingestHandlers(deps: IngestDeps) {
  const maxRuns = deps.maxRuns ?? MAX_RUNS_PER_CLICK;
  const oneAtATime = keyedQueue();

  async function run(job: IngestRequestedJob): Promise<void> {
    const owner = await deps.ownerOf(job.source_id);
    if (owner === null) {
      console.log(`ingest: source ${job.source_id} no longer exists, nothing to do`);
      return;
    }

    let result: IngestResult;
    try {
      result = await deps.ingestSource(job.source_id);
    } catch (error) {
      if (!(error instanceof IngestError)) throw error;
      if (error.code === "source_not_found") {
        console.log(`ingest: source ${job.source_id} was deleted during the run`);
        return;
      }
      // Waiting won't turn a PDF into a note: park it now.
      throw new PermanentError(error.message);
    }

    const step = nextStep(job, result, maxRuns);
    if (step.kind === "follow_up") {
      await deps.publishJob(step.job);
      console.log(
        `ingest: source ${job.source_id} run ${job.run ?? 1} made ${result.itemsCreated}, ` +
          `${result.chunksPending} pending, follow-up run ${step.job.run} queued`,
      );
      return;
    }

    const itemsCreated = job.requested_at
      ? await deps.itemsCreatedSince(job.source_id, new Date(job.requested_at))
      : result.itemsCreated;
    await deps.publishEvent(owner, {
      type: "ingest.completed",
      payload: {
        source_id: job.source_id,
        items_created: itemsCreated,
        chunks: result.chunks,
        chunks_pending: result.chunksPending,
        budget_exhausted: result.budgetExhausted,
      },
    });
    console.log(
      `ingest: source ${job.source_id} done after run ${job.run ?? 1}: ${itemsCreated} new, ` +
        `${result.chunksPending} pending${result.budgetExhausted ? ", budget spent" : ""}`,
    );
  }

  return {
    handle: (job: IngestRequestedJob): Promise<void> => oneAtATime(job.source_id, () => run(job)),

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
