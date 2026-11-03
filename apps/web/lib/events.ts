import {
  ingestCompletedEventSchema,
  ingestFailedEventSchema,
  realtimeTokenResponseSchema,
  wsEnvelopeSchema,
} from "@repo/contracts";
import type { z } from "zod";

/** The events a page can subscribe to, each checked against its contract before delivery. */
const EVENT_SCHEMAS = {
  "ingest.completed": ingestCompletedEventSchema,
  "ingest.failed": ingestFailedEventSchema,
} as const;

export type EventType = keyof typeof EVENT_SCHEMAS;
export type EventOf<T extends EventType> = z.infer<(typeof EVENT_SCHEMAS)[T]>;

/** The parts of a browser WebSocket the client uses. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((message: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  close(): void;
}

export interface EventsClientDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  openSocket: (url: string) => SocketLike;
  /** Where realtime is, e.g. ws://localhost:4100; /events is appended. */
  realtimeUrl: () => string;
  random?: () => number;
}

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

/**
 * One socket to realtime's /events, shared by every subscriber on the page. The first
 * subscriber opens it and the last one closes it. A dropped socket reconnects with backoff,
 * fetching a fresh token each time (tokens live 5 minutes); a 401 means the user signed out,
 * and the client stops.
 */
export function createEventsClient(deps: EventsClientDeps) {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const random = deps.random ?? Math.random;
  let active = false;
  /** Bumped on every start and stop, so a connect that finishes late can tell it is stale. */
  let generation = 0;
  let socket: SocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;

  async function fetchToken(): Promise<string | null> {
    const response = await deps.fetch("/api/realtime-token", { cache: "no-store" });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`GET /api/realtime-token answered ${response.status}`);
    return realtimeTokenResponseSchema.parse(await response.json()).token;
  }

  async function connect(run: number) {
    let token: string | null;
    try {
      token = await fetchToken();
    } catch {
      if (run === generation) retry(run);
      return;
    }
    if (run !== generation) return;
    if (token === null) {
      active = false;
      return;
    }

    const ws = deps.openSocket(`${deps.realtimeUrl()}/events?token=${encodeURIComponent(token)}`);
    socket = ws;
    ws.onopen = () => {
      failures = 0;
    };
    ws.onmessage = (message) => dispatch(message.data);
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      retry(run);
    };
  }

  function retry(run: number) {
    if (run !== generation || !active) return;
    const base = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** failures);
    failures++;
    // ±20% jitter, so a realtime restart isn't followed by every tab reconnecting at once.
    const delay = base * (0.8 + 0.4 * random());
    timer = setTimeout(() => {
      timer = null;
      void connect(run);
    }, delay);
  }

  function dispatch(data: unknown) {
    if (typeof data !== "string") return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const envelope = wsEnvelopeSchema.safeParse(json);
    if (!envelope.success || !(envelope.data.type in EVENT_SCHEMAS)) return;
    const event = EVENT_SCHEMAS[envelope.data.type as EventType].safeParse(json);
    if (!event.success) return;
    for (const handler of handlers.get(envelope.data.type) ?? []) handler(event.data);
  }

  function start() {
    active = true;
    failures = 0;
    generation++;
    void connect(generation);
  }

  function stop() {
    active = false;
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const ws = socket;
    socket = null;
    ws?.close();
  }

  return {
    /** Calls `handler` for every event of `type`; returns the function that unsubscribes. */
    subscribe<T extends EventType>(type: T, handler: (event: EventOf<T>) => void): () => void {
      const listener = handler as (event: unknown) => void;
      const set = handlers.get(type) ?? new Set();
      set.add(listener);
      handlers.set(type, set);
      if (!active) start();
      return () => {
        set.delete(listener);
        if (set.size === 0) handlers.delete(type);
        if (handlers.size === 0) stop();
      };
    },
  };
}

let browserClient: ReturnType<typeof createEventsClient> | undefined;

/**
 * Browser only: call it from a client component's effect, and return what it returns as the
 * effect's cleanup. In production realtime shares the page's origin (Caddy routes /events);
 * in development set NEXT_PUBLIC_REALTIME_URL, e.g. ws://localhost:4100.
 */
export function subscribe<T extends EventType>(
  type: T,
  handler: (event: EventOf<T>) => void,
): () => void {
  browserClient ??= createEventsClient({
    fetch: (input, init) => fetch(input, init),
    openSocket: (url) => {
      const ws = new WebSocket(url);
      const socket: SocketLike = {
        onopen: null,
        onmessage: null,
        onclose: null,
        close: () => ws.close(),
      };
      ws.onopen = () => socket.onopen?.();
      ws.onmessage = (message) => socket.onmessage?.({ data: message.data });
      ws.onclose = () => socket.onclose?.();
      return socket;
    },
    realtimeUrl: () =>
      process.env.NEXT_PUBLIC_REALTIME_URL ||
      `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`,
  });
  return browserClient.subscribe(type, handler);
}
