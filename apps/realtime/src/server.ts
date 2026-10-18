import { createServer, type Server } from "node:http";
import { type HealthResponse, type WsEnvelope, wsEnvelopeSchema } from "@repo/contracts";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MESSAGE_BYTES = 64 * 1024;

export interface RealtimeServer {
  server: Server;
  close: () => Promise<void>;
}

export function createRealtimeServer(): RealtimeServer {
  const startedAt = Date.now();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const body: HealthResponse = {
        status: "ok",
        service: "realtime",
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      return;
    }
    res.writeHead(404).end();
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname !== "/events") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("message", (data, isBinary) => handleMessage(ws, data, isBinary));
  });

  // Connections that stop answering pings (closed laptop, dropped Wi-Fi) are cleaned up.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  return {
    server,
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(heartbeat);
        for (const ws of wss.clients) ws.close(1001, "Server shutting down");
        wss.close();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function handleMessage(ws: WebSocket, data: RawData, isBinary: boolean) {
  if (isBinary) {
    send(ws, { type: "error", payload: { message: "Binary messages are not supported" } });
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(rawDataToString(data));
  } catch {
    send(ws, { type: "error", payload: { message: "Message is not valid JSON" } });
    return;
  }

  const result = wsEnvelopeSchema.safeParse(json);
  if (!result.success) {
    send(ws, {
      type: "error",
      payload: { message: "Message does not match the envelope", issues: result.error.issues },
    });
    return;
  }

  const message = result.data;
  send(ws, { type: "echo", payload: message.payload, request_id: message.request_id });
}

function send(ws: WebSocket, message: WsEnvelope) {
  ws.send(JSON.stringify(message));
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
