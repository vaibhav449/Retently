import { loadEnv } from "./env";
import { startEventsBridge } from "./events";
import { createRealtimeServer } from "./server";

const env = loadEnv();
const realtime = createRealtimeServer({ tokenSecret: env.REALTIME_TOKEN_SECRET });

realtime.server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${env.PORT} is already in use. Stop the other process or set PORT to a free port.`
      : error,
  );
  process.exit(1);
});

realtime.server.listen(env.PORT, env.HOST, () => {
  console.log(`realtime listening on http://${env.HOST}:${env.PORT}`);
});

// Does not wait for RabbitMQ: sockets work while it is away, and events resume when it is back.
const events = await startEventsBridge(env.RABBITMQ_URL, (userId, event) =>
  realtime.sendToUser(userId, event),
);

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, closing connections`);
  await events.close();
  await realtime.close();
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
