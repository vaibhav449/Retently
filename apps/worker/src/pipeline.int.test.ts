import { randomUUID } from "node:crypto";
import type { IngestRequestedJob } from "@repo/contracts";
import { createDb, type Database } from "@repo/db";
import { assertTopology, EXCHANGES, publishJob, QUEUES, type UserEvent } from "@repo/messaging";
import { MockLanguageModelV4 } from "ai/test";
import { type Channel, type ChannelModel, type ConfirmChannel, connect } from "amqplib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { startIngestWorker, type WorkerDeps } from "./app";
import { INGEST_FAILED_MESSAGE } from "./consumers/ingest";

// The whole pipeline, as in production: a job on RabbitMQ, the real ingestSource() on Postgres,
// follow-ups and events. Only the model is fake.

const RETRY_DELAY_MS = 200;
/** What one mocked call costs: 1,000 × $0.75/M + 500 × $3.75/M (packages/llm prices). */
const CALL_COST = 0.002625;

let connection: ChannelModel;
let publisher: ConfirmChannel;
let db: Database;
let closeDb: () => Promise<void>;
/** Channels a test opened; closed after it, so no worker outlives its test. */
let opened: Channel[] = [];

beforeAll(async () => {
  connection = await connect(inject("rabbitmqUrl"));
  publisher = await connection.createConfirmChannel();
  await assertTopology(publisher, { retryDelayMs: RETRY_DELAY_MS });
  ({ db, close: closeDb } = createDb(inject("databaseUrl")));
});

afterAll(async () => {
  await connection.close();
  await closeDb();
});

beforeEach(async () => {
  for (const queue of Object.values(QUEUES)) await publisher.purgeQueue(queue);
});

afterEach(async () => {
  for (const ch of opened) await ch.close().catch(() => undefined);
  opened = [];
});

/** Polls until `check` passes, or fails after `ms`. */
async function eventually(check: () => boolean | Promise<boolean>, ms = 15_000) {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ready = async (queue: string) => (await publisher.checkQueue(queue)).messageCount;

/** A passage long enough to be its own chunk; the number keeps every passage distinct. */
const passage = (i: number) =>
  `Passage ${i} says that fact number ${i} about the cell is worth remembering for the exam.`;
const noteOf = (chunks: number) =>
  Array.from({ length: chunks }, (_, i) => `## Section ${i + 1}\n\n${passage(i + 1)}`).join("\n\n");

/** A user with one note of `chunks` passages, as the documents API creates it. */
async function seedNote(chunks: number) {
  const userId = `user_${randomUUID()}`;
  await db.user.create({
    data: { id: userId, name: "Test", email: `${userId}@example.com`, dob: new Date("2000-01-01") },
  });
  const document = await db.document.create({
    data: {
      ownerId: userId,
      title: "Cells",
      contentMd: noteOf(chunks),
      version: 4,
      source: { create: { ownerId: userId, kind: "note", title: "Cells" } },
    },
    select: { source: { select: { id: true } } },
  });
  return { userId, sourceId: document.source?.id ?? "" };
}

/** The job a "Generate questions" click publishes. */
const clickJob = (sourceId: string): IngestRequestedJob => ({
  type: "ingest.requested",
  v: 1,
  source_id: sourceId,
  version: 4,
  run: 1,
  requested_at: new Date().toISOString(),
});

type Reply = "mcq" | "unusable" | "throw" | "hang";

/** A model that answers each call by `reply(call)`: a fresh valid MCQ by default. */
function mockModel(reply: (call: number) => Reply = () => "mcq") {
  let call = 0;
  return new MockLanguageModelV4({
    modelId: "gemini-3.5-flash",
    doGenerate: () => {
      call++;
      const kind = reply(call);
      if (kind === "throw") return Promise.reject(new Error("LLM unavailable"));
      if (kind === "hang") return new Promise(() => undefined);
      const text =
        kind === "unusable"
          ? "not json"
          : JSON.stringify({
              question: `Question ${call}?`,
              correct_answer: `Right ${call}`,
              wrong_answers: [`Wrong ${call}a`, `Wrong ${call}b`, `Wrong ${call}c`],
            });
      return Promise.resolve({
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "STOP" },
        usage: {
          inputTokens: {
            total: 1_000,
            noCache: 1_000,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 500, text: 500, reasoning: undefined },
        },
        warnings: [],
      });
    },
  });
}

/** A worker on its own channel, wired exactly like apps/worker/src/index.ts. */
async function startWorker(
  model: MockLanguageModelV4,
  options: Partial<Pick<WorkerDeps, "maxRuns" | "maxChunksPerRun">> & {
    dailyBudgetUsd?: number;
  } = {},
) {
  const channel = await connection.createConfirmChannel();
  opened.push(channel);
  const consumer = await startIngestWorker({
    channel,
    db,
    llm: {
      model: () => model,
      dailyBudgetUsd: options.dailyBudgetUsd ?? 0.5,
      clock: { now: () => new Date() },
    },
    maxRuns: options.maxRuns,
    maxChunksPerRun: options.maxChunksPerRun,
  });
  return { channel, consumer };
}

/** Every event published for `userId`, as realtime would receive it. */
async function eventsFor(userId: string): Promise<UserEvent[]> {
  const ch = await connection.createChannel();
  opened.push(ch);
  const { queue } = await ch.assertQueue("", { exclusive: true });
  await ch.bindQueue(queue, EXCHANGES.events, `user.${userId}`);
  const events: UserEvent[] = [];
  await ch.consume(queue, (msg) => {
    if (msg === null) return;
    events.push(JSON.parse(msg.content.toString()) as UserEvent);
    ch.ack(msg);
  });
  return events;
}

const liveItems = (sourceId: string) =>
  db.item.count({ where: { retiredAt: null, sourceChunk: { sourceId } } });

/** No second event arrives, and nothing is left waiting to run. */
async function expectQuiet(events: UserEvent[]) {
  await sleep(300);
  expect(events).toHaveLength(1);
  expect(await ready(QUEUES.ingest)).toBe(0);
  expect(await ready(QUEUES.retryWait)).toBe(0);
}

describe("background question generation", () => {
  it("turns a 3-chunk note into 3 questions and tells the owner once", async () => {
    const { userId, sourceId } = await seedNote(3);
    const events = await eventsFor(userId);
    const model = mockModel();
    await startWorker(model);

    await publishJob(publisher, clickJob(sourceId));
    await eventually(() => events.length === 1);

    expect(events).toEqual([
      {
        type: "ingest.completed",
        payload: {
          source_id: sourceId,
          items_created: 3,
          chunks: 3,
          chunks_pending: 0,
          budget_exhausted: false,
        },
      },
    ]);
    expect(await liveItems(sourceId)).toBe(3);
    expect(model.doGenerateCalls).toHaveLength(3);
    await expectQuiet(events);
  });

  it("finishes a 45-chunk note through follow-ups, with one event for the click", async () => {
    const { userId, sourceId } = await seedNote(45);
    const events = await eventsFor(userId);
    const model = mockModel();
    await startWorker(model);

    await publishJob(publisher, clickJob(sourceId));
    await eventually(() => events.length === 1, 25_000);

    expect(events[0]?.payload).toEqual({
      source_id: sourceId,
      items_created: 45,
      chunks: 45,
      chunks_pending: 0,
      budget_exhausted: false,
    });
    expect(await liveItems(sourceId)).toBe(45);
    expect(model.doGenerateCalls).toHaveLength(45);
    await expectQuiet(events);
  });

  it("stops following up at the cap, and reports what is still pending", async () => {
    const { userId, sourceId } = await seedNote(10);
    const events = await eventsFor(userId);
    await startWorker(mockModel(), { maxChunksPerRun: 2, maxRuns: 3 });

    await publishJob(publisher, clickJob(sourceId));
    await eventually(() => events.length === 1);

    expect(events[0]?.payload).toMatchObject({ items_created: 6, chunks: 10, chunks_pending: 4 });
    expect(await liveItems(sourceId)).toBe(6);
    await expectQuiet(events);
  });

  it("does not follow up a run that made nothing", async () => {
    const { userId, sourceId } = await seedNote(3);
    const events = await eventsFor(userId);
    const model = mockModel(() => "unusable");
    await startWorker(model);

    await publishJob(publisher, clickJob(sourceId));
    await eventually(() => events.length === 1);

    expect(events[0]?.payload).toMatchObject({ items_created: 0, chunks: 3, chunks_pending: 3 });
    expect(model.doGenerateCalls).toHaveLength(3);
    await expectQuiet(events);
  });

  it("creates no duplicates when a worker dies mid-run and another takes over", async () => {
    const { userId, sourceId } = await seedNote(5);
    const events = await eventsFor(userId);
    // Worker A makes two questions, then its model hangs; it dies before it can ack.
    const a = await startWorker(mockModel((call) => (call <= 2 ? "mcq" : "hang")));

    await publishJob(publisher, clickJob(sourceId));
    await eventually(async () => (await liveItems(sourceId)) === 2);
    await a.channel.close();
    const modelB = mockModel();
    await startWorker(modelB);
    await eventually(() => events.length === 1);

    const perChunk = await db.chunk.findMany({
      where: { sourceId, retiredAt: null },
      select: { _count: { select: { items: { where: { retiredAt: null } } } } },
    });
    expect(perChunk.map((chunk) => chunk._count.items)).toEqual([1, 1, 1, 1, 1]);
    // B made the other three; the event counts everything since the click.
    expect(modelB.doGenerateCalls).toHaveLength(3);
    expect(events[0]?.payload).toMatchObject({ items_created: 5, chunks_pending: 0 });
    await expectQuiet(events);
  });

  it("retries a failing model 3 times, parks the job and tells the owner", async () => {
    const { userId, sourceId } = await seedNote(2);
    const events = await eventsFor(userId);
    const model = mockModel(() => "throw");
    await startWorker(model);
    const job = clickJob(sourceId);

    await publishJob(publisher, job);
    await eventually(() => events.length === 1);

    expect(events).toEqual([
      { type: "ingest.failed", payload: { source_id: sourceId, error: INGEST_FAILED_MESSAGE } },
    ]);
    expect(model.doGenerateCalls).toHaveLength(3);
    const parked = await publisher.get(QUEUES.parked, { noAck: true });
    if (!parked) throw new Error("expected a parked job");
    expect(JSON.parse(parked.content.toString())).toEqual(job);
    expect(parked.properties.headers).toMatchObject({
      "x-attempt": 3,
      "x-reason": "failed 3 times: LLM unavailable",
    });
  });

  it("keeps what it made when the budget runs out, with no retry and no follow-up", async () => {
    const { userId, sourceId } = await seedNote(5);
    const events = await eventsFor(userId);
    const model = mockModel();
    // The budget is checked before each call: two calls fit under 1.5 calls' worth.
    await startWorker(model, { dailyBudgetUsd: CALL_COST * 1.5 });

    await publishJob(publisher, clickJob(sourceId));
    await eventually(() => events.length === 1);

    expect(events[0]?.payload).toEqual({
      source_id: sourceId,
      items_created: 2,
      chunks: 5,
      chunks_pending: 3,
      budget_exhausted: true,
    });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(await liveItems(sourceId)).toBe(2);
    expect(await ready(QUEUES.parked)).toBe(0);
    await expectQuiet(events);
  });

  it("parks a job for a PDF at once, and acks one for a deleted note quietly", async () => {
    const { userId, sourceId } = await seedNote(1);
    const events = await eventsFor(userId);
    const model = mockModel();
    await startWorker(model);
    const pdf = await db.source.create({
      data: { ownerId: userId, kind: "pdf", fileKey: "notes.pdf", title: "Notes" },
    });
    await db.source.delete({ where: { id: sourceId } });

    await publishJob(publisher, clickJob(sourceId));
    await publishJob(publisher, clickJob(pdf.id));
    await eventually(() => events.length === 1);

    expect(events[0]).toMatchObject({ type: "ingest.failed", payload: { source_id: pdf.id } });
    const parked = await publisher.get(QUEUES.parked, { noAck: true });
    expect(parked && parked.properties.headers?.["x-attempt"]).toBe(1);
    expect(model.doGenerateCalls).toHaveLength(0);
    await expectQuiet(events);
    expect(await ready(QUEUES.parked)).toBe(0);
  });
});
