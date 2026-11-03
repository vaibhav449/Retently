import { type WsEnvelope, wsEnvelopeSchema } from "@repo/contracts";
import { assertTopology, EXCHANGES } from "@repo/messaging";
import { type ChannelModel, type ConsumeMessage, connect } from "amqplib";

export interface EventsBridge {
  close(): Promise<void>;
}

/** `user.<id>` → the id; null for any other routing key. */
export function userIdOf(routingKey: string): string | null {
  return routingKey.startsWith("user.") && routingKey.length > "user.".length
    ? routingKey.slice("user.".length)
    : null;
}

/**
 * Forwards the `events` exchange to the sockets of the user each event names.
 *
 * It recovers on its own (docs/rabbitmq/09 §3): realtime keeps serving sockets while RabbitMQ
 * is away, and setup() rebuilds the queue and the consumer after every (re)connect. Events
 * published while it is away are lost; they are news, and the UI can always ask again.
 */
export async function startEventsBridge(
  url: string,
  deliver: (userId: string, event: WsEnvelope) => void,
  { onReady }: { onReady?: () => void } = {},
): Promise<EventsBridge> {
  function forward(routingKey: string, content: Buffer) {
    const userId = userIdOf(routingKey);
    let json: unknown;
    try {
      json = JSON.parse(content.toString());
    } catch {
      json = undefined;
    }
    const event = wsEnvelopeSchema.safeParse(json);
    if (!userId || !event.success) {
      console.warn(`realtime: dropped a message on ${routingKey} that is not a user event`);
      return;
    }
    deliver(userId, event.data);
  }

  const connection = await connect(url, {
    // Shown in the RabbitMQ dashboard, so this connection is easy to find.
    clientProperties: { connection_name: "realtime events" },
    recovery: {
      initialDelay: 500,
      maxDelay: 10_000,
      // Start serving sockets now; connect to RabbitMQ in the background.
      waitForConnect: false,
      setup: async (model: ChannelModel) => {
        const ch = await model.createChannel();
        await assertTopology(ch);
        // Exclusive and server-named: it lives exactly as long as this connection.
        const { queue } = await ch.assertQueue("", { exclusive: true });
        await ch.bindQueue(queue, EXCHANGES.events, "user.#");
        // No acks: the queue dies with the connection anyway, so there is nothing to redeliver to.
        await ch.consume(
          queue,
          (msg: ConsumeMessage | null) => {
            if (msg) forward(msg.fields.routingKey, msg.content);
          },
          { noAck: true },
        );
        console.log("realtime: forwarding user events");
        onReady?.();
      },
    },
  });
  connection.on("disconnect", (error: Error) => {
    console.warn(
      `realtime: RabbitMQ disconnected (${error.message}); events pause until it is back`,
    );
  });
  connection.on("error", (error: Error) => console.error("realtime: RabbitMQ error", error));

  return { close: () => connection.close() };
}
