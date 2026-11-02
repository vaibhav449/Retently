import type { IngestResult } from "./consumers/ingest";

/**
 * Stands in for ingestSource() from packages/ingest until Anurag's A4 lands; the weekend
 * integration (I1) swaps it for the real one. Creates nothing.
 */
export function ingestSourceStub(sourceId: string): Promise<IngestResult> {
  console.log(`ingest stub: ${sourceId} (question generation arrives with packages/ingest)`);
  return Promise.resolve({ chunks: 0, itemsCreated: 0, itemsSkipped: 0, budgetExhausted: false });
}
