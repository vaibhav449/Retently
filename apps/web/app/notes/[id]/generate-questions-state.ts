import type { IngestCompletedPayload } from "@repo/contracts";

/** A 20-passage run takes about 40–100 s against Gemini; after this the page stops promising. */
export const SLOW_AFTER_MS = 60_000;

export const MESSAGES = {
  saveFirst: "Save the note first, then try again.",
  queueDown: "Couldn't start generating questions. Try again in a moment.",
  generic: "Couldn't generate questions. Try again.",
  slow: "This is taking longer than usual. Your questions will appear in Review when they're ready.",
} as const;

export type State =
  | { status: "idle" }
  /** flush() of the autosave is in flight. */
  | { status: "saving" }
  /** The POST is in flight. */
  | { status: "sending" }
  /** 202 received; waiting for the worker's event, with the slow timer running. */
  | { status: "queued" }
  /** The timer fired. Still listening, and the button works again. */
  | { status: "slow" }
  | { status: "done"; result: IngestCompletedPayload }
  /** From ingest.failed. */
  | { status: "failed"; message: string }
  /** The click never reached the queue: the save failed, 503, or the network. */
  | { status: "error"; message: string };

export type Action =
  | { type: "click" }
  | { type: "flush_failed" }
  | { type: "flushed" }
  | { type: "accepted" }
  /** `status` is the HTTP status, or 0 for a network error. */
  | { type: "request_failed"; status: number }
  | { type: "timeout" }
  | { type: "completed"; payload: IngestCompletedPayload }
  | { type: "failed"; message: string };

export const IDLE: State = { status: "idle" };

/** The button is off while a click is on its way. */
export const isBusy = (state: State) =>
  state.status === "saving" || state.status === "sending" || state.status === "queued";

/**
 * Whether an event is an answer to this tab's click. The POST counts: an unchanged note's run can
 * finish before its 202 is read. Anything else (another tab's click, a stale chain) is ignored, so
 * a reload or a second tab never shows a result nobody here asked for.
 */
const isWaiting = (state: State) =>
  state.status === "sending" || state.status === "queued" || state.status === "slow";

/** The "Generate questions" button's state machine. Pure: the component owns the IO. */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "click":
      return isBusy(state) ? state : { status: "saving" };
    case "flush_failed":
      return state.status === "saving" ? { status: "error", message: MESSAGES.saveFirst } : state;
    case "flushed":
      return state.status === "saving" ? { status: "sending" } : state;
    case "accepted":
      return state.status === "sending" ? { status: "queued" } : state;
    case "request_failed":
      if (state.status !== "sending") return state;
      return {
        status: "error",
        message: action.status === 503 ? MESSAGES.queueDown : MESSAGES.generic,
      };
    case "timeout":
      return state.status === "queued" ? { status: "slow" } : state;
    case "completed":
      return isWaiting(state) ? { status: "done", result: action.payload } : state;
    case "failed":
      return isWaiting(state) ? { status: "failed", message: action.message } : state;
  }
}
