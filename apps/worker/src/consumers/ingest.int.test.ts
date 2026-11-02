import { randomUUID } from "node:crypto";
import { type IngestRequestedJob, ingestRequestedJobSchema } from "@repo/contracts";
import {
  assertTopology,
  EXCHANGES,
  publishEvent,
  publishJob,
  QUEUES,
  startConsumer,
  type UserEvent,
} from "@repo/messaging";
import { type Channel, type ChannelModel, type ConfirmChannel, connect } from "amqplib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import {
  INGEST_FAILED_MESSAGE,
  type IngestDeps,
  type IngestResult,
  ingestHandlers,
} from "./ingest";

const RETRY_DELAY_MS = 200;
const OWNER = "user_owner";

let connection: ChannelModel;
let publisher: ConfirmChannel;
/** Channels a test opened; closed after it, so its unacked jobs go back to their queue. */
let opened: Channel[] = [];

beforeAll(async () => {
  connection = await connect(inject("rabbitmqUrl"));
  publisher = await connection.createConfirmChannel();
  await assertTopology(publisher, { retryDelayMs: RETRY_DELAY_MS });
});

afterAll(() => connection.close());

beforeEach(async () => {
  for (const queue of Object.values(QUEUES)) await publisher.purgeQueue(queue);
});

afterEach(async () => {
  for (const ch of opened) await ch.close().catch(() => undefined);
  opened = [];
});

/** Polls until `check` passes, or fails after `ms`. */
async function eventually(check: () => boolean | Promise<boolean>, ms = 5000) {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const newJob = (): IngestRequestedJob => ({
  type: "ingest.requested",
  v: 1,
  source_id: randomUUID(),
  version: 1,
});

const ready = async (queue: string) => (await publisher.checkQueue(queue)).messageCount;

/** Every event published for OWNER, as realtime would receive it. */
async function eventsForOwner(): Promise<UserEvent[]> {
  const ch = await connection.createChannel();
  opened.push(ch);
  const { queue } = await ch.assertQueue("", { exclusive: true });
  await ch.bindQueue(queue, EXCHANGES.events, `user.${OWNER}`);
  const events: UserEvent[] = [];
  await ch.consume(queue, (msg) => {
    if (msg === null) return;
    events.push(JSON.parse(msg.content.toString()) as UserEvent);
    ch.ack(msg);
  });
  return events;
}

/** A fake ingestSource(): idempotent per source, like the real one, and fails `failures` times first. */
function fakeIngest(failures = 0) {
  const calls: string[] = [];
  const created = new Set<string>();
  let failed = 0;
  const ingestSource = (sourceId: string): Promise<IngestResult> => {
    calls.push(sourceId);
    if (failed < failures) {
      failed++;
      return Promise.reject(new Error("LLM unavailable"));
    }
    const fresh = !created.has(sourceId);
    created.add(sourceId);
    return Promise.resolve({
      chunks: 1,
      itemsCreated: fresh ? 3 : 0,
      itemsSkipped: fresh ? 0 : 3,
      budgetExhausted: false,
    });
  };
  return { ingestSource, calls, created };
}

/** A worker on its own channel, wired like apps/worker/src/index.ts. */
async function startWorker(
  ingestSource: IngestDeps["ingestSource"],
  handle?: (job: IngestRequestedJob) => Promise<void>,
) {
  const ch = await connection.createConfirmChannel();
  opened.push(ch);
  const handlers = ingestHandlers({
    ownerOf: () => Promise.resolve(OWNER),
    ingestSource,
    publishEvent: (userId, event) => publishEvent(ch, userId, event),
  });
  const consumer = await startConsumer(ch, {
    queue: QUEUES.ingest,
    schema: ingestRequestedJobSchema,
    prefetch: 1,
    maxAttempts: 3,
    handle: handle ?? handlers.handle,
    onGaveUp: handlers.onGaveUp,
  });
  return { ch, consumer };
}

describe("ingest.requested on RabbitMQ", () => {
  it("ingests a job once, tells the owner, and leaves the queue empty", async () => {
    const events = await eventsForOwner();
    const ingest = fakeIngest();
    await startWorker(ingest.ingestSource);
    const job = newJob();

    await publishJob(publisher, job);
    await eventually(() => events.length === 1);

    expect(events).toEqual([
      { type: "ingest.completed", payload: { source_id: job.source_id, items_created: 3 } },
    ]);
    expect(ingest.calls).toEqual([job.source_id]);
    expect(await ready(QUEUES.ingest)).toBe(0);
    expect(await ready(QUEUES.parked)).toBe(0);
  });

  it("retries a failed attempt after the waiting room, then succeeds", async () => {
    const events = await eventsForOwner();
    const ingest = fakeIngest(1);
    await startWorker(ingest.ingestSource);
    const job = newJob();
    const started = Date.now();

    await publishJob(publisher, job);
    await eventually(() => events.length === 1);

    expect(Date.now() - started).toBeGreaterThanOrEqual(RETRY_DELAY_MS);
    expect(ingest.calls).toEqual([job.source_id, job.source_id]);
    expect(events[0]?.type).toBe("ingest.completed");
    expect(await ready(QUEUES.parked)).toBe(0);
  });

  it("parks a job that fails 3 times and tells the owner it gave up", async () => {
    const events = await eventsForOwner();
    const ingest = fakeIngest(Number.POSITIVE_INFINITY);
    await startWorker(ingest.ingestSource);
    const job = newJob();

    await publishJob(publisher, job);
    await eventually(() => events.length === 1);

    expect(events).toEqual([
      {
        type: "ingest.failed",
        payload: { source_id: job.source_id, error: INGEST_FAILED_MESSAGE },
      },
    ]);
    expect(ingest.calls).toHaveLength(3);
    const parked = await publisher.get(QUEUES.parked, { noAck: true });
    if (!parked) throw new Error("expected a parked job");
    expect(JSON.parse(parked.content.toString())).toEqual(job);
    expect(parked.properties.headers).toMatchObject({
      "x-attempt": 3,
      "x-reason": "failed 3 times: LLM unavailable",
      "x-routing-key": "ingest.requested",
    });
  });

  it("parks a broken message at once and never runs the handler", async () => {
    const ingest = fakeIngest();
    await startWorker(ingest.ingestSource);

    publisher.publish(EXCHANGES.jobs, "ingest.requested", Buffer.from("{not json"));
    publisher.publish(
      EXCHANGES.jobs,
      "ingest.requested",
      Buffer.from(JSON.stringify({ type: "ingest.requested", v: 1 })),
    );
    await publisher.waitForConfirms();
    await eventually(async () => (await ready(QUEUES.parked)) === 2);

    expect(ingest.calls).toEqual([]);
    const first = await publisher.get(QUEUES.parked, { noAck: true });
    expect(first && first.properties.headers?.["x-reason"]).toBe("invalid message: not JSON");
  });

  it("brings back a job whose worker died before the ack; its effect still happens once", async () => {
    const events = await eventsForOwner();
    const ingest = fakeIngest();
    // Worker A ingests the source, then dies before it can ack.
    let ingestedByA = false;
    const a = await startWorker(ingest.ingestSource, async (job) => {
      await ingest.ingestSource(job.source_id);
      ingestedByA = true;
      await new Promise(() => undefined);
    });
    const job = newJob();

    await publishJob(publisher, job);
    await eventually(() => ingestedByA);
    await a.ch.close();
    await startWorker(ingest.ingestSource);
    await eventually(() => events.length === 1);

    expect(ingest.calls).toEqual([job.source_id, job.source_id]);
    expect(ingest.created).toEqual(new Set([job.source_id]));
    // Worker B found everything already created, so it reports no new questions.
    expect(events).toEqual([
      { type: "ingest.completed", payload: { source_id: job.source_id, items_created: 0 } },
    ]);
    expect(await ready(QUEUES.ingest)).toBe(0);
  });

  it("on stop, finishes the job in hand and leaves the next one queued", async () => {
    const events = await eventsForOwner();
    const ingest = fakeIngest();
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    const { consumer } = await startWorker(async (sourceId) => {
      started.push(sourceId);
      await gate;
      return ingest.ingestSource(sourceId);
    });
    const [first, second] = [newJob(), newJob()];

    await publishJob(publisher, first);
    await publishJob(publisher, second);
    await eventually(() => started.length === 1);
    const stopping = consumer.stop();
    release();
    await stopping;

    expect(started).toEqual([first.source_id]);
    await eventually(() => events.length === 1);
    expect(events[0]?.payload.source_id).toBe(first.source_id);
    expect(await ready(QUEUES.ingest)).toBe(1);
  });
});
