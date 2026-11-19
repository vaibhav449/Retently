import { describe, expect, it } from "vitest";
import {
  ingestCompletedEventFixture,
  ingestFailedEventFixture,
  ingestRequestedJobFixture,
} from "./fixtures";
import {
  ingestCompletedEventSchema,
  ingestFailedEventSchema,
  ingestRequestedJobSchema,
} from "./jobs";
import { wsEnvelopeSchema } from "./ws";

describe("ingestRequestedJobSchema", () => {
  it("rejects a message format this code does not know", () => {
    const job = { ...ingestRequestedJobFixture, v: 2 };
    expect(ingestRequestedJobSchema.safeParse(job).success).toBe(false);
  });

  it("rejects a job that carries more than ids, such as the note's text", () => {
    const job = { ...ingestRequestedJobFixture, content_md: "# Cell structure" };
    expect(ingestRequestedJobSchema.safeParse(job).success).toBe(false);
  });

  it("rejects a source id that is not a uuid, and a negative version", () => {
    expect(
      ingestRequestedJobSchema.safeParse({ ...ingestRequestedJobFixture, source_id: "note-1" })
        .success,
    ).toBe(false);
    expect(
      ingestRequestedJobSchema.safeParse({ ...ingestRequestedJobFixture, version: -1 }).success,
    ).toBe(false);
  });

  it("still accepts the Phase 1 job, without run or requested_at", () => {
    const old = {
      type: "ingest.requested",
      v: 1,
      source_id: ingestRequestedJobFixture.source_id,
      version: 7,
    };
    expect(ingestRequestedJobSchema.safeParse(old).success).toBe(true);
  });

  it("rejects run 0 and a fractional run", () => {
    for (const run of [0, 1.5]) {
      expect(
        ingestRequestedJobSchema.safeParse({ ...ingestRequestedJobFixture, run }).success,
      ).toBe(false);
    }
  });

  it("rejects a requested_at that is not an ISO date-time", () => {
    for (const requested_at of ["yesterday", "2026-11-18", 1_763_456_400_000]) {
      const job = { ...ingestRequestedJobFixture, requested_at };
      expect(ingestRequestedJobSchema.safeParse(job).success).toBe(false);
    }
  });

  it("rejects another job type", () => {
    const job = { ...ingestRequestedJobFixture, type: "items.generate" };
    expect(ingestRequestedJobSchema.safeParse(job).success).toBe(false);
  });
});

describe("ingest events", () => {
  it("are WebSocket envelopes, so realtime can forward them unchanged", () => {
    expect(wsEnvelopeSchema.safeParse(ingestCompletedEventFixture).success).toBe(true);
    expect(wsEnvelopeSchema.safeParse(ingestFailedEventFixture).success).toBe(true);
  });

  it("still accept the Phase 1 completed payload, with only the count", () => {
    const old = {
      type: "ingest.completed",
      payload: { source_id: ingestCompletedEventFixture.payload.source_id, items_created: 3 },
    };
    expect(ingestCompletedEventSchema.safeParse(old).success).toBe(true);
  });

  it("reject an unknown field in the completed payload", () => {
    const extra = {
      ...ingestCompletedEventFixture,
      payload: { ...ingestCompletedEventFixture.payload, items_skipped: 2 },
    };
    expect(ingestCompletedEventSchema.safeParse(extra).success).toBe(false);
  });

  it("reject a payload that does not match the event type", () => {
    const swapped = { type: "ingest.completed", payload: ingestFailedEventFixture.payload };
    expect(ingestCompletedEventSchema.safeParse(swapped).success).toBe(false);
  });

  it("reject a negative count and an empty error", () => {
    const negative = {
      ...ingestCompletedEventFixture,
      payload: { ...ingestCompletedEventFixture.payload, items_created: -1 },
    };
    const negativePending = {
      ...ingestCompletedEventFixture,
      payload: { ...ingestCompletedEventFixture.payload, chunks_pending: -1 },
    };
    expect(ingestCompletedEventSchema.safeParse(negativePending).success).toBe(false);
    const empty = {
      ...ingestFailedEventFixture,
      payload: { ...ingestFailedEventFixture.payload, error: "" },
    };
    expect(ingestCompletedEventSchema.safeParse(negative).success).toBe(false);
    expect(ingestFailedEventSchema.safeParse(empty).success).toBe(false);
  });
});
