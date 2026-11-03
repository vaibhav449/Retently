import type { AddressInfo } from "node:net";
import { assertTopology, EXCHANGES, publishEvent } from "@repo/messaging";
import { signRealtimeToken } from "@repo/realtime-token";
import { type ChannelModel, type ConfirmChannel, connect } from "amqplib";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { type EventsBridge, startEventsBridge } from "./events";
import { createRealtimeServer, type RealtimeServer } from "./server";
import { openGreeted } from "./test/sockets";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const SOURCE = "6b1f0c2e-4d3a-4f8e-9a1b-2c3d4e5f6a7b";

let realtime: RealtimeServer;
let bridge: EventsBridge;
let publisherConnection: ChannelModel;
let publisher: ConfirmChannel;
let host: string;
/** How many times the bridge finished its setup; recovery runs it again. */
let readyCount = 0;

beforeAll(async () => {
  realtime = createRealtimeServer({ tokenSecret: SECRET });
  await new Promise<void>((resolve) => realtime.server.listen(0, "127.0.0.1", resolve));
  host = `127.0.0.1:${(realtime.server.address() as AddressInfo).port}`;

  bridge = await startEventsBridge(
    inject("rabbitmqUrl"),
    (userId, event) => realtime.sendToUser(userId, event),
    { onReady: () => readyCount++ },
  );
  await eventually(() => readyCount === 1);

  publisherConnection = await connect(inject("rabbitmqUrl"));
  publisher = await publisherConnection.createConfirmChannel();
  await assertTopology(publisher);
});

afterAll(async () => {
  await publisherConnection.close();
  await bridge.close();
  await realtime.close();
});

async function eventually(check: () => boolean, ms = 15_000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function socketFor(userId: string) {
  const token = await signRealtimeToken({ userId }, SECRET);
  return openGreeted(`ws://${host}/events?token=${encodeURIComponent(token)}`);
}

const completed = (itemsCreated: number) =>
  ({
    type: "ingest.completed",
    payload: { source_id: SOURCE, items_created: itemsCreated },
  }) as const;

describe("events from RabbitMQ to the sockets", () => {
  it("delivers a user's event to that user's socket and to nobody else", async () => {
    const [mine, theirs] = await Promise.all([socketFor("user_a"), socketFor("user_b")]);

    await publishEvent(publisher, "user_a", completed(5));

    expect(await mine.next()).toEqual(completed(5));
    expect(await theirs.next(300)).toBeUndefined();
    mine.ws.close();
    theirs.ws.close();
  });

  it("drops a message that is not an event, and keeps forwarding the next one", async () => {
    const mine = await socketFor("user_a");

    publisher.publish(EXCHANGES.events, "user.user_a", Buffer.from("not json"));
    await publisher.waitForConfirms();
    expect(await mine.next(300)).toBeUndefined();

    await publishEvent(publisher, "user_a", completed(1));
    expect(await mine.next()).toEqual(completed(1));
    mine.ws.close();
  });

  it("reconnects by itself after RabbitMQ drops its connection", async () => {
    const mine = await socketFor("user_a");
    await closeBridgeConnection();
    await eventually(() => readyCount === 2);

    await publishEvent(publisher, "user_a", completed(7));

    expect(await mine.next()).toEqual(completed(7));
    mine.ws.close();
  });
});

/** Closes the bridge's connection from the broker side, as a RabbitMQ restart would. */
async function closeBridgeConnection() {
  const amqp = new URL(inject("rabbitmqUrl"));
  const api = `http://${amqp.hostname}:15672/api`;
  const user = decodeURIComponent(amqp.username);
  const password = decodeURIComponent(amqp.password);
  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  const vhost = amqp.pathname.slice(1);

  let name: string | undefined;
  // The management API lists a new connection a few seconds after it opens.
  async function find() {
    const response = await fetch(`${api}/vhosts/${vhost}/connections`, {
      headers: { authorization },
    });
    const connections = (await response.json()) as {
      name: string;
      client_properties?: { connection_name?: string };
    }[];
    return connections.find((c) => c.client_properties?.connection_name === "realtime events")
      ?.name;
  }
  for (let i = 0; i < 50 && name === undefined; i++) {
    name = await find();
    if (name === undefined) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (name === undefined) throw new Error("the bridge's connection never showed up");

  const response = await fetch(`${api}/connections/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { authorization, "x-reason": "test: simulate a broker restart" },
  });
  if (!response.ok) throw new Error(`closing the connection: ${response.status}`);
}
