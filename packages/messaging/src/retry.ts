import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import { publishConfirmed } from "./publish";
import { EXCHANGES, QUEUES } from "./topology";

/** This delivery's attempt number, from our own `x-attempt` header (1 on the first try). */
export function attemptOf(msg: Pick<ConsumeMessage, "properties">): number {
  const value = Number(msg.properties.headers?.["x-attempt"] ?? 1);
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

/**
 * Try again later: publish a NEW copy to the waiting room with `x-attempt + 1`, wait for its
 * confirm, and only then ack the original. In that order a crash can duplicate the job but
 * never lose it. The copy starts with a clean `x-death` history, so RabbitMQ never mistakes
 * the retry loop for a dead-letter cycle and drops it (docs/rabbitmq/07, "mazboot design").
 */
export async function retryLater(
  ch: ConfirmChannel,
  msg: ConsumeMessage,
  attempt: number,
): Promise<void> {
  await publishConfirmed(ch, EXCHANGES.retry, msg.fields.routingKey, msg.content, {
    persistent: true,
    contentType: msg.properties.contentType as string | undefined,
    headers: { "x-attempt": attempt + 1 },
  });
  ch.ack(msg);
}

/** Give up: copy the job to the parking lot with the reason, confirm, then ack the original. */
export async function park(ch: ConfirmChannel, msg: ConsumeMessage, reason: string): Promise<void> {
  await publishConfirmed(ch, "", QUEUES.parked, msg.content, {
    persistent: true,
    contentType: msg.properties.contentType as string | undefined,
    headers: {
      "x-attempt": attemptOf(msg),
      "x-reason": reason,
      "x-routing-key": msg.fields.routingKey,
    },
  });
  ch.ack(msg);
}
