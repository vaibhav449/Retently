import type { AddressInfo } from "node:net";
import { healthResponseSchema } from "@repo/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createRealtimeServer, type RealtimeServer } from "./server";

let realtime: RealtimeServer;
let host: string;

beforeAll(async () => {
  realtime = createRealtimeServer();
  await new Promise<void>((resolve) => realtime.server.listen(0, "127.0.0.1", resolve));
  const { port } = realtime.server.address() as AddressInfo;
  host = `127.0.0.1:${port}`;
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

function sendAndReceive(message: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}/events`);
    ws.on("open", () => ws.send(message));
    ws.on("message", (data: Buffer) => {
      resolve(JSON.parse(data.toString("utf8")));
      ws.close();
    });
    ws.on("error", reject);
  });
}
