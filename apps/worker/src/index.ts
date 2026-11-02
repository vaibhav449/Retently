import { createServer } from "node:http";
import { type HealthResponse, ingestRequestedJobSchema } from "@repo/contracts";
import { createDb } from "@repo/db";
import {
  assertTopology,
  connectWithRetry,
  publishEvent,
  QUEUES,
  startConsumer,
} from "@repo/messaging";
import { ingestHandlers } from "./consumers/ingest";
import { loadEnv } from "./env";
import { ingestSourceStub } from "./ingest-stub";

const env = loadEnv();
const startedAt = Date.now();
let shuttingDown = false;

const { db, close: closeDb } = createDb(env.DATABASE_URL);
const connection = await connectWithRetry(env.RABBITMQ_URL);
console.log("worker connected to RabbitMQ");

connection.on("error", (error) => console.error("RabbitMQ connection error", error));
connection.on("close", () => {
  if (shuttingDown) return;
  // Crash on purpose: Docker's restart policy brings the worker back with a fresh connection.
  console.error("RabbitMQ connection closed unexpectedly, exiting");
  process.exit(1);
});

// A confirm channel, so a retry copy or a parked job counts as sent only once RabbitMQ has it.
const channel = await connection.createConfirmChannel();
channel.on("close", () => {
  if (shuttingDown) return;
  console.error("RabbitMQ channel closed unexpectedly, exiting");
  process.exit(1);
});
await assertTopology(channel);

const ingest = ingestHandlers({
  ownerOf: async (sourceId) => {
    const source = await db.source.findUnique({
      where: { id: sourceId },
      select: { ownerId: true },
    });
    return source?.ownerId ?? null;
  },
  ingestSource: ingestSourceStub,
  publishEvent: (userId, event) => publishEvent(channel, userId, event),
});
const consumer = await startConsumer(channel, {
  queue: QUEUES.ingest,
  schema: ingestRequestedJobSchema,
  // An ingest job is mostly LLM calls: a few at a time is plenty, and fair across workers.
  prefetch: 4,
  maxAttempts: 3,
  handle: ingest.handle,
  onGaveUp: ingest.onGaveUp,
});
console.log(`worker consuming ${QUEUES.ingest}`);

const health = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const body: HealthResponse = {
      status: "ok",
      service: "worker",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return;
  }
  res.writeHead(404).end();
});

health.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${env.HEALTH_PORT} is already in use. Stop the other process or set HEALTH_PORT to a free port.`
      : error,
  );
  process.exit(1);
});

health.listen(env.HEALTH_PORT, () => {
  console.log(`worker health check on port ${env.HEALTH_PORT}`);
});

/** Stop taking jobs, finish the ones in hand, then close (docs/rabbitmq/09 §4). */
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: no new jobs, finishing the ones in hand`);
  health.close();
  await consumer.stop();
  await channel.close();
  await connection.close();
  await closeDb();
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
