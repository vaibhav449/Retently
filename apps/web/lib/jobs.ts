import { assertTopology, type Job, publishJob } from "@repo/messaging";
import { type ChannelModel, type ConfirmChannel, connect, type SocketOptions } from "amqplib";
import { getJobsEnv } from "./env";

/** A broker that doesn't answer within this long is treated as down; the click gets a 503. */
export const CONNECT_TIMEOUT_MS = 2_000;

/** Shown in the RabbitMQ dashboard's connection list. */
export const CONNECTION_NAME = "web jobs";

export interface JobsPublisher {
  /** Publishes the job and waits for the broker's confirm. Rejects on any failure. */
  publish(job: Job): Promise<void>;
  /** Closes the connection; the next publish opens a new one. */
  close(): Promise<void>;
}

/** amqplib's connect() without its recovery overload: the cache does the reconnecting. */
export type Connect = (url: string, socketOptions: SocketOptions) => Promise<ChannelModel>;

interface Open {
  connection: ChannelModel;
  channel: ConfirmChannel;
}

/**
 * One lazily opened connection and confirm channel, shared by every publish. A failed connect,
 * or a connection or channel that closes later (broker restart, network drop), is forgotten, so
 * the next publish reconnects. Nothing retries inside a request: a click while the broker is
 * down fails fast and the student clicks again.
 */
export function createJobsPublisher(url: () => string, open: Connect = connect): JobsPublisher {
  let current: Promise<Open> | null = null;

  /** `forget` drops this attempt from the cache, if it is still the cached one. */
  async function openChannel(forget: () => void): Promise<Open> {
    const connection = await open(url(), {
      timeout: CONNECT_TIMEOUT_MS,
      clientProperties: { connection_name: CONNECTION_NAME },
    });
    // Listeners first: an unhandled "error" event would crash the server.
    connection.on("error", (error) => {
      console.error("RabbitMQ connection error (web jobs)", error);
      forget();
    });
    connection.on("close", forget);
    try {
      const channel = await connection.createConfirmChannel();
      channel.on("error", (error) => console.error("RabbitMQ channel error (web jobs)", error));
      channel.on("close", () => {
        forget();
        connection.close().catch(() => undefined);
      });
      await assertTopology(channel);
      return { connection, channel };
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  function get(): Promise<Open> {
    if (current) return current;
    const forget = () => {
      if (current === attempt) current = null;
    };
    const attempt = openChannel(forget);
    current = attempt;
    attempt.catch(forget);
    return attempt;
  }

  return {
    publish: async (job) => {
      const { channel } = await get();
      await publishJob(channel, job);
    },
    close: async () => {
      const closing = current;
      current = null;
      const opened = await closing?.catch(() => null);
      await opened?.connection.close().catch(() => undefined);
    },
  };
}

// One publisher per server process. In development, hot reload re-runs this module, so it is
// kept on globalThis to avoid a new connection on every edit.
const globalForJobs = globalThis as { retentlyJobs?: JobsPublisher };

/** Server only. Publishes an `ingest.requested` job through the process's shared connection. */
export function publishIngestJob(job: Job): Promise<void> {
  globalForJobs.retentlyJobs ??= createJobsPublisher(() => getJobsEnv().RABBITMQ_URL);
  return globalForJobs.retentlyJobs.publish(job);
}
