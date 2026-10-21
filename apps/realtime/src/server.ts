import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { type HealthResponse, type WsEnvelope, wsEnvelopeSchema } from "@repo/contracts";
import { verifyRealtimeToken } from "@repo/realtime-token";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MESSAGE_BYTES = 64 * 1024;

export interface RealtimeServerOptions {
  /** Same secret as apps/web, which signs the tokens. */
  tokenSecret: string;
}

export interface RealtimeServer {
  server: Server;
  close: () => Promise<void>;
}

/** What the server knows about one open socket. */
interface Connection {
  userId: string;
  alive: boolean;
}

export function createRealtimeServer(options: RealtimeServerOptions): RealtimeServer {
  const startedAt = Date.now();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const connections = new WeakMap<WebSocket, Connection>();

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
    upgrade(req, socket, head).catch((error: unknown) => {
      console.error("WebSocket upgrade failed", error);
      socket.destroy();
    });
  });

  // Only a valid realtime token gets a socket; everything else gets 401 before the handshake.
  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/events") {
      socket.destroy();
      return;
    }

    // Node removes its own error handler before 'upgrade'. Without one, a client that
    // disconnects while the token is being verified crashes the process.
    socket.on("error", onSocketError);
    const userId = await authenticate(url.searchParams.get("token"), options.tokenSecret);
    if (!userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    socket.removeListener("error", onSocketError);
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, userId));
  }

  function onConnection(ws: WebSocket, userId: string) {
    const connection: Connection = { userId, alive: true };
    connections.set(ws, connection);
    ws.on("pong", () => {
      connection.alive = true;
    });
    ws.on("message", (data, isBinary) => handleMessage(ws, data, isBinary));
    send(ws, { type: "connected", payload: { user_id: connection.userId } });
  }

  // Connections that stop answering pings (closed laptop, dropped Wi-Fi) are cleaned up.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const connection = connections.get(ws);
      if (!connection?.alive) {
        ws.terminate();
        continue;
      }
      connection.alive = false;
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

/** The user id inside a valid token, or null for a missing, expired or forged one. */
async function authenticate(token: string | null, secret: string): Promise<string | null> {
  if (!token) return null;
  const result = await verifyRealtimeToken(token, secret);
  return result.ok ? result.claims.userId : null;
}

function onSocketError() {
  // Node has already destroyed the socket; there is nothing else to clean up.
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
