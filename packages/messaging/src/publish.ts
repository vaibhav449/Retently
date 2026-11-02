import {
  type IngestCompletedEvent,
  ingestCompletedEventSchema,
  type IngestFailedEvent,
  ingestFailedEventSchema,
  type IngestRequestedJob,
  ingestRequestedJobSchema,
} from "@repo/contracts";
import type { ConfirmChannel, Options } from "amqplib";
import { EXCHANGES } from "./topology";

export type Job = IngestRequestedJob;
export type UserEvent = IngestCompletedEvent | IngestFailedEvent;

/**
 * Publishes and waits for the broker's confirm for this message, so "sent" means RabbitMQ has
 * it. Rejects if the broker refuses it (docs/rabbitmq/05).
 */
export function publishConfirmed(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  content: Buffer,
  options: Options.Publish,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ch.publish(exchange, routingKey, content, options, (error) => {
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve();
    });
  });
}

/** Sends a job to the worker. Checked against its contract before it leaves. */
export async function publishJob(ch: ConfirmChannel, job: Job): Promise<void> {
  const body = ingestRequestedJobSchema.parse(job);
  await publishConfirmed(ch, EXCHANGES.jobs, body.type, Buffer.from(JSON.stringify(body)), {
    persistent: true,
    contentType: "application/json",
    headers: { "x-attempt": 1 },
  });
}

/**
 * Tells one user that something finished. Not persistent: it is news, and realtime's queues
 * live only as long as realtime does, so the UI can always ask again.
 */
export async function publishEvent(
  ch: ConfirmChannel,
  userId: string,
  event: UserEvent,
): Promise<void> {
  const body =
    event.type === "ingest.completed"
      ? ingestCompletedEventSchema.parse(event)
      : ingestFailedEventSchema.parse(event);
  await publishConfirmed(
    ch,
    EXCHANGES.events,
    `user.${userId}`,
    Buffer.from(JSON.stringify(body)),
    { contentType: "application/json" },
  );
}
