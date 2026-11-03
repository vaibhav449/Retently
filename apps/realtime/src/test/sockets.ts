import { WebSocket } from "ws";

/**
 * Opens a socket and waits for the server's greeting. `next()` resolves with the next message,
 * or undefined if none arrives within `ms`.
 */
export async function openGreeted(url: string) {
  const ws = new WebSocket(url);
  const queue: unknown[] = [];
  const waiting: ((message: unknown) => void)[] = [];
  ws.on("message", (data: Buffer) => {
    const message: unknown = JSON.parse(data.toString("utf8"));
    const waiter = waiting.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  const next = (ms = 2000): Promise<unknown> => {
    if (queue.length > 0) return Promise.resolve(queue.shift());
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(done), 1);
        resolve(undefined);
      }, ms);
      const done = (message: unknown) => {
        clearTimeout(timer);
        resolve(message);
      };
      waiting.push(done);
    });
  };
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  await next(); // the "connected" greeting
  return { ws, next };
}
