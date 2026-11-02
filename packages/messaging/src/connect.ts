import { setTimeout as sleep } from "node:timers/promises";
import { type ChannelModel, connect } from "amqplib";

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/** Exponential backoff: 500ms, 1s, 2s, 4s ... capped at maxDelayMs. */
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
}

/** RabbitMQ can take a few seconds to accept connections after its container starts. */
export async function connectWithRetry(
  url: string,
  { attempts = 10, baseDelayMs = 500, maxDelayMs = 10_000 }: RetryOptions = {},
): Promise<ChannelModel> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connect(url);
    } catch (error) {
      if (attempt >= attempts) throw error;
      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      console.warn(
        `RabbitMQ not reachable (attempt ${attempt}/${attempts}), retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
}
