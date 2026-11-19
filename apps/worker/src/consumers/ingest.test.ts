import type { IngestRequestedJob } from "@repo/contracts";
import { IngestError, type IngestResult } from "@repo/ingest";
import { PermanentError, type UserEvent } from "@repo/messaging";
import { describe, expect, it } from "vitest";
import {
  INGEST_FAILED_MESSAGE,
  type IngestDeps,
  ingestHandlers,
  keyedQueue,
  MAX_RUNS_PER_CLICK,
  type NextStep,
  nextStep,
} from "./ingest";

const SOURCE = "6b1f0c2e-4d3a-4f8e-9a1b-2c3d4e5f6a7b";
const OTHER_SOURCE = "7c2a1d3f-5e4b-4a9f-8b2c-3d4e5f6a7b8c";
const REQUESTED_AT = "2026-11-18T09:00:00.000Z";
const job: IngestRequestedJob = {
  type: "ingest.requested",
  v: 1,
  source_id: SOURCE,
  version: 3,
  run: 1,
  requested_at: REQUESTED_AT,
};

const result = (overrides: Partial<IngestResult> = {}): IngestResult => ({
  chunks: 4,
  itemsCreated: 3,
  itemsSkipped: 1,
  budgetExhausted: false,
  chunksPending: 0,
  ...overrides,
});

/** A promise and the function that settles it. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakes(owner: string | null, run: (sourceId: string) => Promise<IngestResult>) {
  const ingested: string[] = [];
  const sent: [string, UserEvent][] = [];
  const published: IngestRequestedJob[] = [];
  const counted: [string, Date][] = [];
  const deps: IngestDeps = {
    ownerOf: () => Promise.resolve(owner),
    ingestSource: (sourceId) => {
      ingested.push(sourceId);
      return run(sourceId);
    },
    itemsCreatedSince: (sourceId, since) => {
      counted.push([sourceId, since]);
      return Promise.resolve(11);
    },
    publishJob: (followUp) => {
      published.push(followUp);
      return Promise.resolve();
    },
    publishEvent: (userId, event) => {
      sent.push([userId, event]);
      return Promise.resolve();
    },
  };
  return { deps, ingested, sent, published, counted };
}

describe("nextStep", () => {
  it.each<[string, NextStep["kind"], Partial<IngestResult>, number | undefined]>([
    ["nothing pending", "complete", { chunksPending: 0 }, 1],
    ["budget spent", "complete", { chunksPending: 5, budgetExhausted: true }, 1],
    ["no progress", "complete", { chunksPending: 5, itemsCreated: 0 }, 1],
    ["the cap reached", "complete", { chunksPending: 5 }, MAX_RUNS_PER_CLICK],
    ["passages pending after progress", "follow_up", { chunksPending: 5 }, 1],
    ["passages pending, one run before the cap", "follow_up", { chunksPending: 5 }, 9],
    ["a job without a run number", "follow_up", { chunksPending: 5 }, undefined],
  ])("%s → %s", (_case, kind, overrides, run) => {
    expect(nextStep({ ...job, run }, result(overrides)).kind).toBe(kind);
  });

  it("follows up with the same job, one run later, keeping the click's time", () => {
    expect(nextStep({ ...job, run: 2 }, result({ chunksPending: 5 }))).toEqual({
      kind: "follow_up",
      job: { ...job, run: 3 },
    });
    expect(nextStep({ ...job, run: undefined }, result({ chunksPending: 5 }))).toEqual({
      kind: "follow_up",
      job: { ...job, run: 2 },
    });
  });

  it("honours a smaller cap", () => {
    expect(nextStep({ ...job, run: 2 }, result({ chunksPending: 5 }), 2).kind).toBe("complete");
  });
});

describe("ingestHandlers", () => {
  it("ingests the source and tells its owner the totals since the click", async () => {
    const { deps, ingested, sent, counted, published } = fakes("user_1", () =>
      Promise.resolve(result()),
    );
    await ingestHandlers(deps).handle(job);
    expect(ingested).toEqual([SOURCE]);
    expect(published).toEqual([]);
    expect(counted).toEqual([[SOURCE, new Date(REQUESTED_AT)]]);
    expect(sent).toEqual([
      [
        "user_1",
        {
          type: "ingest.completed",
          payload: {
            source_id: SOURCE,
            items_created: 11,
            chunks: 4,
            chunks_pending: 0,
            budget_exhausted: false,
          },
        },
      ],
    ]);
  });

  it("without the click's time, reports this run's own count", async () => {
    const { deps, sent, counted } = fakes("user_1", () => Promise.resolve(result()));
    await ingestHandlers(deps).handle({ ...job, requested_at: undefined });
    expect(counted).toEqual([]);
    expect(sent[0]?.[1].payload).toMatchObject({ items_created: 3 });
  });

  it("publishes a follow-up instead of an event while passages are pending", async () => {
    const { deps, sent, published } = fakes("user_1", () =>
      Promise.resolve(result({ chunksPending: 25 })),
    );
    await ingestHandlers(deps).handle(job);
    expect(published).toEqual([{ ...job, run: 2 }]);
    expect(sent).toEqual([]);
  });

  it("reports a spent budget as a success, with no follow-up", async () => {
    const { deps, sent, published } = fakes("user_1", () =>
      Promise.resolve(result({ chunksPending: 3, budgetExhausted: true })),
    );
    await ingestHandlers(deps).handle(job);
    expect(published).toEqual([]);
    expect(sent[0]?.[1]).toMatchObject({
      type: "ingest.completed",
      payload: { chunks_pending: 3, budget_exhausted: true },
    });
  });

  it("does nothing for a source deleted after the job was sent", async () => {
    const { deps, ingested, sent } = fakes(null, () => Promise.resolve(result()));
    await ingestHandlers(deps).handle(job);
    expect(ingested).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("acks quietly when the source is deleted during the run", async () => {
    const { deps, sent, published } = fakes("user_1", () =>
      Promise.reject(new IngestError("source_not_found", `No source ${SOURCE}`)),
    );
    await expect(ingestHandlers(deps).handle(job)).resolves.toBeUndefined();
    expect(sent).toEqual([]);
    expect(published).toEqual([]);
  });

  it("parks an unsupported source at once", async () => {
    const { deps } = fakes("user_1", () =>
      Promise.reject(new IngestError("unsupported_source", "Only notes can be ingested")),
    );
    const handled = ingestHandlers(deps).handle(job);
    await expect(handled).rejects.toBeInstanceOf(PermanentError);
    await expect(handled).rejects.toThrow("Only notes can be ingested");
  });

  it("lets a model or database error through, so the job is retried", async () => {
    const outage = new Error("LLM unavailable");
    const { deps, sent } = fakes("user_1", () => Promise.reject(outage));
    await expect(ingestHandlers(deps).handle(job)).rejects.toBe(outage);
    expect(sent).toEqual([]);
  });

  it("runs two jobs for one source one after the other, and other sources alongside", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<IngestResult>>>();
    const started: string[] = [];
    const { deps } = fakes("user_1", (sourceId) => {
      const gate = deferred<IngestResult>();
      started.push(sourceId);
      gates.set(`${sourceId}#${started.filter((s) => s === sourceId).length}`, gate);
      return gate.promise;
    });
    const handlers = ingestHandlers(deps);
    const otherJob = { ...job, source_id: OTHER_SOURCE };

    const first = handlers.handle(job);
    const second = handlers.handle(job);
    const other = handlers.handle(otherJob);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual([SOURCE, OTHER_SOURCE]);

    gates.get(`${SOURCE}#1`)?.resolve(result());
    await first;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual([SOURCE, OTHER_SOURCE, SOURCE]);

    gates.get(`${SOURCE}#2`)?.resolve(result());
    gates.get(`${OTHER_SOURCE}#1`)?.resolve(result());
    await Promise.all([second, other]);
  });

  it("tells the owner when it gave up, without the internal reason", async () => {
    const { deps, sent } = fakes("user_1", () => Promise.resolve(result()));
    await ingestHandlers(deps).onGaveUp(job);
    expect(sent).toEqual([
      [
        "user_1",
        { type: "ingest.failed", payload: { source_id: SOURCE, error: INGEST_FAILED_MESSAGE } },
      ],
    ]);
  });
});

describe("keyedQueue", () => {
  it("goes on with the next task after one fails", async () => {
    const run = keyedQueue();
    const failing = run("a", () => Promise.reject(new Error("boom")));
    const next = run("a", () => Promise.resolve("ok"));
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
