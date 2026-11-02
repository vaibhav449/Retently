import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import { decideOnError } from "./decide";
import { attemptOf, park, retryLater } from "./retry";

export interface ConsumerOptions<T> {
  queue: string;
  /** The job's contract, e.g. ingestRequestedJobSchema. */
  schema: { parse(input: unknown): T };
  /** How many unacked jobs this channel holds at once. */
  prefetch: number;
  /** Attempts before a failing job is parked. */
  maxAttempts: number;
  /** Throws to fail the attempt; returning acks the job. Must be safe to run twice. */
  handle(job: T): Promise<void>;
  /** Runs once, after a job is parked for good. */
  onGaveUp?(job: T, reason: string): Promise<void>;
}

export interface Consumer {
  /** Stops new deliveries, then waits for the jobs in hand to finish (docs/rabbitmq/09 §4). */
  stop(): Promise<void>;
}

/**
 * The worker's loop for one queue. Delivery is at-least-once: a job is acked only after its
 * handler finishes, so a crash before that brings it back, and handlers must be idempotent.
 */
export async function startConsumer<T>(
  ch: ConfirmChannel,
  options: ConsumerOptions<T>,
): Promise<Consumer> {
  await ch.prefetch(options.prefetch);
  const inFlight = new Set<Promise<void>>();

  async function settle(msg: ConsumeMessage): Promise<void> {
    let job: T;
    try {
      job = options.schema.parse(JSON.parse(msg.content.toString()));
    } catch (error) {
      // A broken message can't get better by waiting: park it, never retry it.
      await park(ch, msg, `invalid message: ${describeInvalid(error)}`);
      return;
    }

    const attempt = attemptOf(msg);
    try {
      await options.handle(job);
      ch.ack(msg);
    } catch (error) {
      const outcome = decideOnError(error, attempt, options.maxAttempts);
      if (outcome.kind === "retry") {
        await retryLater(ch, msg, attempt);
        return;
      }
      await park(ch, msg, outcome.reason);
      await options.onGaveUp?.(job, outcome.reason);
    }
  }

  const { consumerTag } = await ch.consume(options.queue, (msg) => {
    if (msg === null) return; // the broker cancelled this consumer
    const work = settle(msg)
      .catch((error: unknown) => {
        // Usually a closed channel. The job was not acked, so RabbitMQ delivers it again.
        console.error(`${options.queue}: job not settled`, error);
      })
      .finally(() => inFlight.delete(work));
    inFlight.add(work);
  });

  return {
    stop: async () => {
      await ch.cancel(consumerTag);
      await Promise.all(inFlight);
    },
  };
}

/** One line for the parking lot: "not JSON", or the contract's complaints, field by field. */
export function describeInvalid(error: unknown): string {
  if (error instanceof SyntaxError) return "not JSON";
  if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
    return (error.issues as { path?: unknown[]; message?: string }[])
      .map((issue) => `${issue.path?.join(".") || "(message)"}: ${issue.message ?? "invalid"}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
