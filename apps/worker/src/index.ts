import { createServer } from "node:http";
import type { HealthResponse } from "@repo/contracts";
import { loadEnv } from "./env";
import { connectWithRetry } from "./rabbitmq";

const env = loadEnv();
const startedAt = Date.now();
let shuttingDown = false;

const connection = await connectWithRetry(env.RABBITMQ_URL);
console.log("worker connected to RabbitMQ");

connection.on("error", (error) => console.error("RabbitMQ connection error", error));
connection.on("close", () => {
  if (shuttingDown) return;
  // Crash on purpose: Docker's restart policy brings the worker back with a fresh connection.
  console.error("RabbitMQ connection closed unexpectedly, exiting");
  process.exit(1);
});

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

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, closing RabbitMQ connection`);
  health.close();
  await connection.close();
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
