import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventsClient, type SocketLike } from "./events";

const SOURCE = "6b1f0c2e-4d3a-4f8e-9a1b-2c3d4e5f6a7b";
const completed = {
  type: "ingest.completed",
  payload: { source_id: SOURCE, items_created: 4 },
} as const;
const failed = {
  type: "ingest.failed",
  payload: { source_id: SOURCE, error: "Try again later." },
} as const;

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close() {
    this.closed = true;
  }
  receive(message: unknown) {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) });
  }
  drop() {
    this.onclose?.();
  }
}

/** A client wired to fakes: `tokens` answer /api/realtime-token in order (401 = signed out). */
function setup(tokens: (string | 401)[]) {
  const sockets: FakeSocket[] = [];
  const fetch = vi.fn(() => {
    const next = tokens.shift() ?? 401;
    return Promise.resolve(
      next === 401
        ? new Response(null, { status: 401 })
        : Response.json({ token: next, expires_in: 300 }),
    );
  });
  const client = createEventsClient({
    fetch,
    openSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    realtimeUrl: () => "ws://realtime.test",
    random: () => 0.5, // no jitter
  });
  return { client, sockets, fetch };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createEventsClient", () => {
  it("opens one socket with a fresh token and delivers each event to its type's handlers", async () => {
    const { client, sockets } = setup(["token-1"]);
    const onCompleted = vi.fn();
    const onFailed = vi.fn();
    client.subscribe("ingest.completed", onCompleted);
    client.subscribe("ingest.failed", onFailed);
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets.map((s) => s.url)).toEqual(["ws://realtime.test/events?token=token-1"]);
    const [socket] = sockets;
    socket?.receive({ type: "connected", payload: { user_id: "user_1" } });
    socket?.receive("not json");
    socket?.receive({ type: "ingest.completed", payload: { source_id: "not-a-uuid" } });
    socket?.receive(completed);

    expect(onCompleted.mock.calls).toEqual([[completed]]);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("reconnects after a drop with a new token, waiting longer after each failure", async () => {
    const { client, sockets, fetch } = setup(["token-1", "token-2", "token-3"]);
    client.subscribe("ingest.completed", () => undefined);
    await vi.advanceTimersByTimeAsync(0);

    sockets[0]?.drop();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets[1]?.url).toBe("ws://realtime.test/events?token=token-2");

    sockets[1]?.drop(); // never opened: the next wait doubles
    await vi.advanceTimersByTimeAsync(1999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets[2]?.url).toBe("ws://realtime.test/events?token=token-3");
  });

  it("closes the socket when the last subscriber leaves, and stays closed", async () => {
    const { client, sockets, fetch } = setup(["token-1", "token-2"]);
    const stopCompleted = client.subscribe("ingest.completed", () => undefined);
    const stopFailed = client.subscribe("ingest.failed", () => undefined);
    await vi.advanceTimersByTimeAsync(0);

    stopCompleted();
    expect(sockets[0]?.closed).toBe(false);
    stopFailed();
    expect(sockets[0]?.closed).toBe(true);
    sockets[0]?.drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops when the user is signed out, and starts again for the next subscriber", async () => {
    const { client, sockets, fetch } = setup([401, "token-2"]);
    const onFailed = vi.fn();
    const stop = client.subscribe("ingest.failed", onFailed);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    stop();

    client.subscribe("ingest.failed", onFailed);
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]?.receive(failed);
    expect(onFailed.mock.calls).toEqual([[failed]]);
  });
});
