/** A failure that waiting can't fix, such as bad data: the job is parked at once. */
export class PermanentError extends Error {
  override name = "PermanentError";
}

export type ErrorOutcome = { kind: "retry" } | { kind: "give_up"; reason: string };

/** What to do with a job whose handler threw. Pure, so it is tested without RabbitMQ. */
export function decideOnError(error: unknown, attempt: number, maxAttempts: number): ErrorOutcome {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof PermanentError) return { kind: "give_up", reason: message };
  if (attempt >= maxAttempts) {
    return { kind: "give_up", reason: `failed ${attempt} times: ${message}` };
  }
  return { kind: "retry" };
}
