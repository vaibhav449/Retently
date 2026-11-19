import { createServer } from "node:http";
import type { HealthResponse } from "@repo/contracts";
import { createDb } from "@repo/db";
import { defaultModel } from "@repo/llm";
import { assertTopology, connectWithRetry, QUEUES } from "@repo/messaging";
import { startIngestWorker } from "./app";
import { type Env, loadEnv } from "./env";

// Checked before anything connects: without a model key every job would only be parked.
let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
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

// A confirm channel, so a follow-up, a retry copy or a parked job counts as sent only once
// RabbitMQ has it.
const channel = await connection.createConfirmChannel();
channel.on("close", () => {
  if (shuttingDown) return;
  console.error("RabbitMQ channel closed unexpectedly, exiting");
  process.exit(1);
});
await assertTopology(channel);

const consumer = await startIngestWorker({
  channel,
  db,
  llm: {
    model: defaultModel,
    dailyBudgetUsd: env.LLM_DAILY_BUDGET_USD,
    clock: { now: () => new Date() },
  },
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
