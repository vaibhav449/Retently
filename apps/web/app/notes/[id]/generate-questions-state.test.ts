import type { IngestCompletedPayload } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import {
  type Action,
  IDLE,
  isBusy,
  MESSAGES,
  reduce,
  type State,
} from "./generate-questions-state";

const payload: IngestCompletedPayload = {
  source_id: "6b1f0c2e-4d3a-4f8e-9a1b-2c3d4e5f6a7b",
  items_created: 3,
  chunks: 3,
  chunks_pending: 0,
  budget_exhausted: false,
};

const run = (actions: Action[], from: State = IDLE) => actions.reduce(reduce, from);
const queued = run([{ type: "click" }, { type: "flushed" }, { type: "accepted" }]);

const ALL: State[] = [
  IDLE,
  { status: "saving" },
  { status: "sending" },
  { status: "queued" },
  { status: "slow" },
  { status: "done", result: payload },
  { status: "failed", message: "x" },
  { status: "error", message: "x" },
];

describe("reduce", () => {
  it("goes idle → saving → sending → queued → done on the happy path", () => {
    expect(run([{ type: "click" }])).toEqual({ status: "saving" });
    expect(run([{ type: "click" }, { type: "flushed" }])).toEqual({ status: "sending" });
    expect(queued).toEqual({ status: "queued" });
    expect(reduce(queued, { type: "completed", payload })).toEqual({
      status: "done",
      result: payload,
    });
  });

  it("shows the event's message when the worker gave up", () => {
    expect(reduce(queued, { type: "failed", message: "Try later." })).toEqual({
      status: "failed",
      message: "Try later.",
    });
  });

  it("says to save first when the autosave flush fails", () => {
    expect(run([{ type: "click" }, { type: "flush_failed" }])).toEqual({
      status: "error",
      message: MESSAGES.saveFirst,
    });
  });

  it.each([
    [503, MESSAGES.queueDown],
    [500, MESSAGES.generic],
    [0, MESSAGES.generic],
  ])("turns a failed request (%i) into its message", (status, message) => {
    const sending = run([{ type: "click" }, { type: "flushed" }]);
    expect(reduce(sending, { type: "request_failed", status })).toEqual({
      status: "error",
      message,
    });
  });

  it("turns slow only from queued, and still takes a late event", () => {
    const slow = reduce(queued, { type: "timeout" });
    expect(slow).toEqual({ status: "slow" });
    expect(reduce(slow, { type: "timeout" })).toBe(slow);
    expect(reduce(slow, { type: "completed", payload })).toMatchObject({ status: "done" });
    for (const state of ALL.filter((s) => s.status !== "queued")) {
      expect(reduce(state, { type: "timeout" })).toBe(state);
    }
  });

  it("takes an event that beats the 202, then ignores the late 202", () => {
    const sending = run([{ type: "click" }, { type: "flushed" }]);
    const done = reduce(sending, { type: "completed", payload });
    expect(done).toMatchObject({ status: "done" });
    expect(reduce(done, { type: "accepted" })).toBe(done);
  });

  it("ignores events while not waiting: idle, saving, or after a result", () => {
    for (const state of ALL.filter((s) => !["sending", "queued", "slow"].includes(s.status))) {
      expect(reduce(state, { type: "completed", payload })).toBe(state);
      expect(reduce(state, { type: "failed", message: "x" })).toBe(state);
    }
  });

  it("ignores a second click while one is on its way, and allows one once slow or done", () => {
    for (const state of ALL) {
      const next = reduce(state, { type: "click" });
      expect(next).toEqual(isBusy(state) ? state : { status: "saving" });
    }
    expect(ALL.filter(isBusy).map((s) => s.status)).toEqual(["saving", "sending", "queued"]);
  });

  it("ignores request results that arrive in the wrong state", () => {
    expect(reduce(IDLE, { type: "accepted" })).toBe(IDLE);
    expect(reduce(IDLE, { type: "flushed" })).toBe(IDLE);
    expect(reduce(IDLE, { type: "flush_failed" })).toBe(IDLE);
    expect(reduce(queued, { type: "request_failed", status: 503 })).toBe(queued);
  });
});
