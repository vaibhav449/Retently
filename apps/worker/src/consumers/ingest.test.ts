import type { IngestRequestedJob } from "@repo/contracts";
import type { UserEvent } from "@repo/messaging";
import { describe, expect, it } from "vitest";
import { INGEST_FAILED_MESSAGE, type IngestDeps, ingestHandlers } from "./ingest";

const SOURCE = "6b1f0c2e-4d3a-4f8e-9a1b-2c3d4e5f6a7b";
const job: IngestRequestedJob = { type: "ingest.requested", v: 1, source_id: SOURCE, version: 3 };

function fakes(owner: string | null) {
  const ingested: string[] = [];
  const sent: [string, UserEvent][] = [];
  const deps: IngestDeps = {
    ownerOf: () => Promise.resolve(owner),
    ingestSource: (sourceId) => {
      ingested.push(sourceId);
      return Promise.resolve({
        chunks: 4,
        itemsCreated: 7,
        itemsSkipped: 1,
        budgetExhausted: false,
      });
    },
    publishEvent: (userId, event) => {
      sent.push([userId, event]);
      return Promise.resolve();
    },
  };
  return { deps, ingested, sent };
}

describe("ingestHandlers", () => {
  it("ingests the source and tells its owner how many questions were made", async () => {
    const { deps, ingested, sent } = fakes("user_1");
    await ingestHandlers(deps).handle(job);
    expect(ingested).toEqual([SOURCE]);
    expect(sent).toEqual([
      ["user_1", { type: "ingest.completed", payload: { source_id: SOURCE, items_created: 7 } }],
    ]);
  });

  it("does nothing for a source deleted after the job was sent", async () => {
    const { deps, ingested, sent } = fakes(null);
    await ingestHandlers(deps).handle(job);
    expect(ingested).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("tells the owner when it gave up, without the internal reason", async () => {
    const { deps, sent } = fakes("user_1");
    await ingestHandlers(deps).onGaveUp(job);
    expect(sent).toEqual([
      [
        "user_1",
        { type: "ingest.failed", payload: { source_id: SOURCE, error: INGEST_FAILED_MESSAGE } },
      ],
    ]);
  });
});
