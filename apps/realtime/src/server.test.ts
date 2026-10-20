import type { AddressInfo } from "node:net";
import { healthResponseSchema } from "@repo/contracts";
import { REALTIME_TOKEN_TTL_SECONDS, signRealtimeToken } from "@repo/realtime-token";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createRealtimeServer, type RealtimeServer } from "./server";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const OTHER_SECRET = "another-secret-that-is-at-least-32-characters";

let realtime: RealtimeServer;
let host: string;
let validToken: string;

beforeAll(async () => {
  realtime = createRealtimeServer({ tokenSecret: SECRET });
  await new Promise<void>((resolve) => realtime.server.listen(0, "127.0.0.1", resolve));
  const { port } = realtime.server.address() as AddressInfo;
  host = `127.0.0.1:${port}`;
  validToken = await signRealtimeToken({ userId: "user_1" }, SECRET);
});

afterAll(() => realtime.close());

describe("realtime server", () => {
  it("reports health", async () => {
    const response = await fetch(`http://${host}/health`);
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toMatchObject({
      status: "ok",
      service: "realtime",
    });
  });

  it("echoes a valid envelope on /events", async () => {
    const reply = await sendAndReceive(
      JSON.stringify({ type: "ping", payload: { n: 1 }, request_id: "r1" }),
    );
    expect(reply).toEqual({ type: "echo", payload: { n: 1 }, request_id: "r1" });
  });

  it("answers invalid JSON with an error envelope", async () => {
    const reply = await sendAndReceive("not json");
    expect(reply).toMatchObject({ type: "error" });
  });

  it("refuses WebSocket upgrades on other paths", async () => {
    const ws = new WebSocket(`ws://${host}/somewhere-else`);
    await expect(
      new Promise((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
      }),
    ).rejects.toThrow();
  });
});

describe("token check on /events", () => {
  it("greets a valid token with the user id", async () => {
    expect(await firstMessage(eventsUrl(validToken))).toEqual({
      type: "connected",
      payload: { user_id: "user_1" },
    });
  });

  it("rejects a connection without a token with 401", async () => {
    expect(await refusedStatus(`ws://${host}/events`)).toBe(401);
  });

  it("rejects an expired token with 401", async () => {
    const issuedAt = new Date(Date.now() - (REALTIME_TOKEN_TTL_SECONDS + 60) * 1000);
    const expired = await signRealtimeToken({ userId: "user_1" }, SECRET, issuedAt);
    expect(await refusedStatus(eventsUrl(expired))).toBe(401);
  });

  it("rejects a token signed with another secret with 401", async () => {
    const forged = await signRealtimeToken({ userId: "user_1" }, OTHER_SECRET);
    expect(await refusedStatus(eventsUrl(forged))).toBe(401);
  });
});

function eventsUrl(token: string): string {
  return `ws://${host}/events?token=${encodeURIComponent(token)}`;
}

// Listeners are attached before the socket opens: the server greets immediately, and the
// greeting can arrive in the same packet as the handshake.
function firstMessage(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("message", (data: Buffer) => {
      resolve(JSON.parse(data.toString("utf8")));
      ws.close();
    });
    ws.on("error", reject);
  });
}

/** Waits for the greeting, sends one message and resolves with the reply. */
function sendAndReceive(message: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(eventsUrl(validToken));
    ws.once("message", () => {
      ws.on("message", (data: Buffer) => {
        resolve(JSON.parse(data.toString("utf8")));
        ws.close();
      });
      ws.send(message);
    });
    ws.on("error", reject);
  });
}

/** Resolves with the HTTP status of an upgrade the server refused. */
function refusedStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("unexpected-response", (req, res) => {
      resolve(res.statusCode ?? 0);
      req.destroy();
    });
    ws.on("open", () => reject(new Error("The server accepted the socket")));
    ws.on("error", reject);
  });
}
