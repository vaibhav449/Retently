import { createServer, type Socket } from "node:net";
import type { IngestRequestedJob } from "@repo/contracts";
import { assertTopology, QUEUES } from "@repo/messaging";
// Declares inject("rabbitmqUrl"): the throwaway vhost from the global setup.
import type {} from "@repo/messaging/testing";
import { type ChannelModel, connect } from "amqplib";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import {
  CONNECT_TIMEOUT_MS,
  CONNECTION_NAME,
  createJobsPublisher,
  type JobsPublisher,
  publishIngestJob,
} from "./jobs";

const job: IngestRequestedJob = {
  type: "ingest.requested",
  v: 1,
  source_id: "6b1f0c2e-4d3a-4f8e-9a1b-2c3d4e5f6a7b",
  version: 7,
  run: 1,
  requested_at: "2026-11-18T09:00:00.000Z",
};

let admin: ChannelModel;
let url: string;
/** Publishers a test made; closed after it. */
let made: JobsPublisher[] = [];

beforeAll(async () => {
  url = inject("rabbitmqUrl");
  admin = await connect(url);
  // The same topology every publisher asserts, so the queues exist before the first purge.
  const ch = await admin.createChannel();
  await assertTopology(ch);
  await ch.close();
});

afterAll(() => admin.close());

beforeEach(async () => {
  const ch = await admin.createChannel();
  await ch.purgeQueue(QUEUES.ingest);
  await ch.close();
});

afterEach(async () => {
  for (const publisher of made) await publisher.close();
  made = [];
  vi.restoreAllMocks();
});

/** A publisher whose connections are counted and kept, so a test can see and drop them. */
function countingPublisher(target: () => string = () => url) {
  const opened: ChannelModel[] = [];
  const publisher = createJobsPublisher(target, async (target, options) => {
    const connection = await connect(target, options);
    opened.push(connection);
    return connection;
  });
  made.push(publisher);
  return { publisher, opened };
}

async function takeIngestJob() {
  const ch = await admin.createChannel();
  try {
    return await ch.get(QUEUES.ingest, { noAck: true });
  } finally {
    await ch.close();
  }
}

/** Polls until `check` passes, or fails after `ms`. */
async function eventually(check: () => boolean | Promise<boolean>, ms = 10_000) {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Closes this vhost's "web jobs" connections from the broker's side, like a broker restart. */
async function brokerDropsConnections() {
  const amqp = new URL(url);
  const api = `http://${amqp.hostname}:15672/api`;
  const credentials = `${decodeURIComponent(amqp.username)}:${decodeURIComponent(amqp.password)}`;
  const authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
  let names: string[] = [];
  await eventually(async () => {
    const response = await fetch(`${api}/vhosts/${amqp.pathname.slice(1)}/connections`, {
      headers: { authorization },
    });
    const list = (await response.json()) as {
      name: string;
      client_properties?: { connection_name?: string };
    }[];
    names = list
      .filter((c) => c.client_properties?.connection_name === CONNECTION_NAME)
      .map((c) => c.name);
    return names.length > 0;
  });
  for (const name of names) {
    await fetch(`${api}/connections/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: { authorization, "x-reason": "test: broker drops the connection" },
    });
  }
}

describe("createJobsPublisher", () => {
  it("puts the job on the ingest queue as its first attempt", async () => {
    const { publisher } = countingPublisher();

    await publisher.publish(job);

    const message = await takeIngestJob();
    if (!message) throw new Error("expected a job on the ingest queue");
    expect(JSON.parse(message.content.toString())).toEqual(job);
    expect(message.properties.headers).toMatchObject({ "x-attempt": 1 });
    expect(message.properties.deliveryMode).toBe(2);
  });

  it("opens one connection for concurrent first publishes, and reuses it", async () => {
    const { publisher, opened } = countingPublisher();

    await Promise.all([publisher.publish(job), publisher.publish(job)]);
    await publisher.publish(job);

    expect(opened).toHaveLength(1);
  });

  it("rejects quickly when nothing listens on the broker's port", async () => {
    const { publisher } = countingPublisher(() => "amqp://app:app@127.0.0.1:1");
    const started = Date.now();

    await expect(publisher.publish(job)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it("gives up on a broker that accepts the connection but never answers", async () => {
    const sockets: Socket[] = [];
    const silent = createServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const { port } = silent.address() as { port: number };
    const { publisher } = countingPublisher(() => `amqp://app:app@127.0.0.1:${port}`);
    const started = Date.now();

    try {
      await expect(publisher.publish(job)).rejects.toThrow(/ETIMEDOUT/);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(CONNECT_TIMEOUT_MS - 100);
      expect(elapsed).toBeLessThan(CONNECT_TIMEOUT_MS + 500);
    } finally {
      for (const socket of sockets) socket.destroy();
      silent.close();
    }
  });

  it("forgets a failed connect, so the next publish tries again", async () => {
    let target = "amqp://app:app@127.0.0.1:1";
    const { publisher, opened } = countingPublisher(() => target);

    await expect(publisher.publish(job)).rejects.toThrow();
    target = url;
    await publisher.publish(job);

    expect(opened).toHaveLength(1);
    expect(await takeIngestJob()).toBeTruthy();
  });

  it("reconnects after the broker drops the connection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { publisher, opened } = countingPublisher();
    await publisher.publish(job);
    const first = opened[0];
    if (!first) throw new Error("expected a connection");
    const closed = new Promise((resolve) => first.once("close", resolve));

    await brokerDropsConnections();
    await closed;
    await publisher.publish(job);

    expect(opened).toHaveLength(2);
  });
});

describe("publishIngestJob", () => {
  it("rejects, rather than throwing, without RABBITMQ_URL", async () => {
    vi.stubEnv("RABBITMQ_URL", "");
    try {
      await expect(publishIngestJob(job)).rejects.toThrow(/RABBITMQ_URL/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("publishes through one connection per process, kept across module reloads", async () => {
    vi.stubEnv("RABBITMQ_URL", url);
    try {
      await publishIngestJob(job);
      const shared = (globalThis as { retentlyJobs?: JobsPublisher }).retentlyJobs;
      expect(shared).toBeDefined();
      await publishIngestJob(job);
      expect((globalThis as { retentlyJobs?: JobsPublisher }).retentlyJobs).toBe(shared);
      await shared?.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
