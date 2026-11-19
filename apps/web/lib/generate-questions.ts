import type { GenerateQuestionsQueuedResponse, IngestRequestedJob } from "@repo/contracts";
import { z } from "zod";

/** How long a click waits for the broker's confirm before it answers 503. */
export const PUBLISH_DEADLINE_MS = 3_000;

export interface RequestQuestionsDeps {
  /** The signed-in user, or null. */
  userId: string | null;
  /** The user's note with its source id and version; null when missing or someone else's. */
  findNote(
    userId: string,
    documentId: string,
  ): Promise<{ sourceId: string; version: number } | null>;
  /** Publishes the job and resolves once the broker has confirmed it. */
  publish(job: IngestRequestedJob): Promise<void>;
  now(): Date;
}

export type RequestQuestionsResult =
  | { status: 202; body: GenerateQuestionsQueuedResponse }
  | { status: 401; body: { error: string } }
  | { status: 404; body: { error: "not_found"; message: string } }
  | { status: 503; body: { error: "queue_unavailable"; message: string } };

// Someone else's note answers 404, the same as a missing one, so ids cannot be probed.
const NOT_FOUND = { error: "not_found", message: "No such note" } as const;
const QUEUE_UNAVAILABLE = {
  error: "queue_unavailable",
  message: "Couldn't start generating questions. Try again in a moment.",
} as const;

/** Rejects when `work` has not settled within `ms`. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no confirm within ${ms} ms`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * POST /api/documents/:id/questions ("Generate questions"): queues one `ingest.requested` job for
 * the note and answers 202 at once. The worker makes the questions and tells the page through
 * `ingest.completed`. No model is called here. The client flushes its autosave first, so the
 * saved text is what the student sees. A second click only queues a harmless duplicate.
 */
export async function requestQuestions(
  documentId: string,
  deps: RequestQuestionsDeps,
): Promise<RequestQuestionsResult> {
  if (deps.userId === null) {
    return { status: 401, body: { error: "Sign in to generate questions" } };
  }
  if (!z.uuid().safeParse(documentId).success) return { status: 404, body: NOT_FOUND };
  const note = await deps.findNote(deps.userId, documentId);
  if (!note) return { status: 404, body: NOT_FOUND };

  const job: IngestRequestedJob = {
    type: "ingest.requested",
    v: 1,
    source_id: note.sourceId,
    version: note.version,
    run: 1,
    requested_at: deps.now().toISOString(),
  };
  try {
    await withDeadline(deps.publish(job), PUBLISH_DEADLINE_MS);
  } catch (error) {
    // A late confirm still runs the job; a second click is then a harmless duplicate.
    console.error("Couldn't queue question generation", error);
    return { status: 503, body: QUEUE_UNAVAILABLE };
  }
  return { status: 202, body: { status: "queued" } };
}
