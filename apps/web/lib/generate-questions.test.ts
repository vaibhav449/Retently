import type { IngestRequestedJob } from "@repo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PUBLISH_DEADLINE_MS,
  type RequestQuestionsDeps,
  requestQuestions,
} from "./generate-questions";

const NOTE = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const SOURCE = "6b1f0c2e-4d3a-4f8e-9a1b-2c3d4e5f6a7b";
const NOW = new Date("2026-11-18T09:00:00.000Z");

function fakes(overrides: Partial<RequestQuestionsDeps> = {}) {
  const published: IngestRequestedJob[] = [];
  const lookedUp: [string, string][] = [];
  const deps: RequestQuestionsDeps = {
    userId: "user_1",
    findNote: (userId, documentId) => {
      lookedUp.push([userId, documentId]);
      return Promise.resolve(documentId === NOTE ? { sourceId: SOURCE, version: 7 } : null);
    },
    publish: (job) => {
      published.push(job);
      return Promise.resolve();
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, published, lookedUp };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("requestQuestions", () => {
  it("queues the click's job and answers 202 without waiting for the worker", async () => {
    const { deps, published, lookedUp } = fakes();

    expect(await requestQuestions(NOTE, deps)).toEqual({
      status: 202,
      body: { status: "queued" },
    });
    expect(lookedUp).toEqual([["user_1", NOTE]]);
    expect(published).toEqual([
      {
        type: "ingest.requested",
        v: 1,
        source_id: SOURCE,
        version: 7,
        run: 1,
        requested_at: "2026-11-18T09:00:00.000Z",
      },
    ]);
  });

  it("answers 401 without a session, and publishes nothing", async () => {
    const { deps, published } = fakes({ userId: null });
    expect(await requestQuestions(NOTE, deps)).toMatchObject({ status: 401 });
    expect(published).toEqual([]);
  });

  it.each([
    ["an id that is not a uuid", "not-a-uuid"],
    ["a missing or foreign note", "7c2a1d3f-5e4b-4a9f-8b2c-3d4e5f6a7b8c"],
  ])("answers 404 for %s, and publishes nothing", async (_case, id) => {
    const { deps, published } = fakes();
    expect(await requestQuestions(id, deps)).toEqual({
      status: 404,
      body: { error: "not_found", message: "No such note" },
    });
    expect(published).toEqual([]);
  });

  it("does not look up an id that is not a uuid", async () => {
    const { deps, lookedUp } = fakes();
    await requestQuestions("1; DROP TABLE documents", deps);
    expect(lookedUp).toEqual([]);
  });

  it("answers 503 with a plain message when the broker refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps } = fakes({ publish: () => Promise.reject(new Error("ECONNREFUSED")) });
    expect(await requestQuestions(NOTE, deps)).toEqual({
      status: 503,
      body: {
        error: "queue_unavailable",
        message: "Couldn't start generating questions. Try again in a moment.",
      },
    });
  });

  it("answers 503 at the deadline when the confirm never comes", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps } = fakes({ publish: () => new Promise(() => undefined) });

    let answered: unknown;
    void requestQuestions(NOTE, deps).then((result) => {
      answered = result;
    });
    await vi.advanceTimersByTimeAsync(PUBLISH_DEADLINE_MS - 1);
    expect(answered).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toMatchObject({ status: 503, body: { error: "queue_unavailable" } });
  });

  it("keeps the deadline under the 5-second promise", () => {
    expect(PUBLISH_DEADLINE_MS).toBeLessThan(5_000);
  });
});
