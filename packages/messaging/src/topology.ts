import type { Channel } from "amqplib";

/** Every RabbitMQ name in one place, so no two apps can ever declare them differently. */
export const EXCHANGES = {
  /** Commands for the worker, routed by job type. */
  jobs: "jobs",
  /** Where the worker republishes a failed job to wait before its next attempt. */
  retry: "jobs.retry",
  /** News for one user, routing key `user.<id>`; realtime forwards it to their socket. */
  events: "events",
} as const;

export const QUEUES = {
  ingest: "ingest",
  retryWait: "jobs.retry.wait",
  /** Jobs that gave up. Nothing leaves it on its own: a person looks at what lands here. */
  parked: "jobs.parked",
} as const;

/** How long a failed job waits before its next attempt. */
export const RETRY_DELAY_MS = 10_000;

/** Deliveries that end without an ack (a worker crashing on the job) before it is parked. */
const DELIVERY_LIMIT = 5;

export interface TopologyOptions {
  /**
   * Tests shorten the wait. Queue arguments can't change once a queue exists (406
   * PRECONDITION_FAILED), so every app in one environment must use the same value.
   */
  retryDelayMs?: number;
}

/**
 * Declares every exchange, queue and binding. Idempotent: each app runs it on start
 * (docs/rabbitmq/09 §2: topology as code, one source of truth).
 */
export async function assertTopology(
  ch: Channel,
  { retryDelayMs = RETRY_DELAY_MS }: TopologyOptions = {},
): Promise<void> {
  await ch.assertExchange(EXCHANGES.jobs, "topic", { durable: true });
  await ch.assertExchange(EXCHANGES.retry, "topic", { durable: true });
  await ch.assertExchange(EXCHANGES.events, "topic", { durable: true });

  // No dead-letter exchange on the parking lot: whatever lands here stays.
  await ch.assertQueue(QUEUES.parked, { durable: true, arguments: { "x-queue-type": "quorum" } });

  await ch.assertQueue(QUEUES.ingest, {
    durable: true,
    arguments: {
      "x-queue-type": "quorum",
      "x-delivery-limit": DELIVERY_LIMIT,
      // Any dead letter, such as a crash loop past the delivery limit, goes straight to the
      // parking lot. Through the retry room, RabbitMQ could drop it as a dead-letter cycle (07).
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": QUEUES.parked,
    },
  });
  await ch.bindQueue(QUEUES.ingest, EXCHANGES.jobs, "ingest.requested");

  // One waiting room for every job type. On expiry a job goes back to `jobs` with its own
  // routing key, so it returns to the queue it came from.
  await ch.assertQueue(QUEUES.retryWait, {
    durable: true,
    arguments: {
      "x-queue-type": "quorum",
      "x-message-ttl": retryDelayMs,
      "x-dead-letter-exchange": EXCHANGES.jobs,
    },
  });
  await ch.bindQueue(QUEUES.retryWait, EXCHANGES.retry, "#");
}
