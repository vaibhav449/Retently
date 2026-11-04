import type { McqItem } from "@repo/contracts";
import type { Database } from "@repo/db";
import {
  BudgetExceededError,
  generateStructured,
  type LlmDeps,
  NoObjectGeneratedError,
} from "@repo/llm";
import { type ChunkDraft, chunkMarkdown } from "./chunker";
import { buildMcqItem, MCQ_INSTRUCTIONS, mcqDraftSchema, mcqPrompt } from "./mcq";

/** Chunks sent to the model in one run; the rest wait for the next run. */
export const MAX_CHUNKS_PER_RUN = 20;

export interface IngestDeps extends LlmDeps {
  maxChunksPerRun?: number;
}

/** What one run did. The first four fields are the worker's IngestResult (seam 2). */
export interface IngestResult {
  /** Live chunks the note has now. */
  chunks: number;
  itemsCreated: number;
  /** Chunks that already had a question, so nothing was generated for them. */
  itemsSkipped: number;
  /** The owner's daily LLM budget ran out during the run. */
  budgetExhausted: boolean;
  /** Chunks still without a question: over the per-run cap, out of budget, or an unusable reply. */
  chunksPending: number;
}

export class IngestError extends Error {
  constructor(
    readonly code: "source_not_found" | "unsupported_source",
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

interface LiveChunk extends ChunkDraft {
  id: string;
  hasItem: boolean;
}

/**
 * Makes the source's live chunks match `drafts`, in one transaction under a per-source lock so two
 * runs cannot both create a chunk. A chunk whose text is gone is retired with its items (never
 * deleted: old reviews keep their citation); a passage that comes back revives its old chunk and
 * items instead of generating new ones. Returns the chunks in note order.
 */
function syncChunks(
  db: Database,
  sourceId: string,
  drafts: ChunkDraft[],
  now: Date,
): Promise<LiveChunk[]> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ingest:${sourceId}`}))`;
    const wanted = new Set(drafts.map((draft) => draft.contentHash));
    const existing = await tx.chunk.findMany({
      where: { sourceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, contentHash: true, retiredAt: true },
    });

    const gone = existing
      .filter((chunk) => chunk.retiredAt === null && !wanted.has(chunk.contentHash))
      .map((chunk) => chunk.id);
    if (gone.length > 0) {
      await tx.chunk.updateMany({ where: { id: { in: gone } }, data: { retiredAt: now } });
      await tx.item.updateMany({
        where: { sourceChunkId: { in: gone }, retiredAt: null },
        data: { retiredAt: now },
      });
    }

    // Prefer a live chunk for each hash, else the oldest retired one.
    const byHash = new Map<string, { id: string; retiredAt: Date | null }>();
    for (const chunk of existing) {
      const current = byHash.get(chunk.contentHash);
      if (!current || (current.retiredAt !== null && chunk.retiredAt === null)) {
        byHash.set(chunk.contentHash, chunk);
      }
    }

    const live: LiveChunk[] = [];
    for (const draft of drafts) {
      const match = byHash.get(draft.contentHash);
      let id: string;
      if (!match) {
        ({ id } = await tx.chunk.create({
          data: {
            sourceId,
            blockIds: [],
            text: draft.text,
            contentHash: draft.contentHash,
            createdAt: now,
          },
          select: { id: true },
        }));
      } else {
        id = match.id;
        if (match.retiredAt !== null) {
          await tx.chunk.update({ where: { id }, data: { retiredAt: null } });
          await tx.item.updateMany({
            where: { sourceChunkId: id, retiredAt: match.retiredAt },
            data: { retiredAt: null },
          });
        }
      }
      const items = await tx.item.count({ where: { sourceChunkId: id, retiredAt: null } });
      live.push({ ...draft, id, hasItem: items > 0 });
    }
    return live;
  });
}

/**
 * Stores the item unless the chunk got one meanwhile (another run) or was retired. The row lock
 * on the chunk makes the check and the insert one step. True when the item was stored.
 */
function saveItem(db: Database, item: McqItem): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const [chunk] = await tx.$queryRaw<{ retired_at: Date | null }[]>`
      SELECT retired_at FROM chunks WHERE id = ${item.source_chunk_id}::uuid FOR UPDATE`;
    if (!chunk || chunk.retired_at !== null) return false;
    const items = await tx.item.count({
      where: { sourceChunkId: item.source_chunk_id, retiredAt: null },
    });
    if (items > 0) return false;
    await tx.item.create({
      data: {
        id: item.id,
        sourceChunkId: item.source_chunk_id,
        type: "mcq",
        prompt: item.prompt,
        answer: item.answer,
        options: item.options,
        answerOptionId: item.answer_option_id,
        createdAt: new Date(item.created_at),
      },
    });
    return true;
  });
}

/**
 * Turns a note into MCQs (seam 2). Reads only `documents.content_md`, chunks it, makes the stored
 * chunks match, and asks the model for one MCQ per chunk that has none yet, at most
 * `maxChunksPerRun` per run, charged to the source's owner. Idempotent: a second run on an
 * unchanged note creates nothing and calls no model. When the owner's budget runs out it stops
 * cleanly: questions made so far are kept, and the rest wait for the next run.
 */
export async function ingestSource(sourceId: string, deps: IngestDeps): Promise<IngestResult> {
  const source = await deps.db.source.findUnique({
    where: { id: sourceId },
    select: { ownerId: true, kind: true, document: { select: { contentMd: true } } },
  });
  if (!source) throw new IngestError("source_not_found", `No source ${sourceId}`);
  if (source.kind !== "note" || !source.document) {
    throw new IngestError("unsupported_source", "Only notes can be ingested in Phase 1");
  }

  const chunks = await syncChunks(
    deps.db,
    sourceId,
    chunkMarkdown(source.document.contentMd),
    deps.clock.now(),
  );

  const limit = deps.maxChunksPerRun ?? MAX_CHUNKS_PER_RUN;
  const result: IngestResult = {
    chunks: chunks.length,
    itemsCreated: 0,
    itemsSkipped: 0,
    budgetExhausted: false,
    chunksPending: 0,
  };
  let attempted = 0;

  for (const chunk of chunks) {
    if (chunk.hasItem) {
      result.itemsSkipped++;
      continue;
    }
    if (result.budgetExhausted || attempted >= limit) {
      result.chunksPending++;
      continue;
    }
    attempted++;
    try {
      const { object } = await generateStructured(deps, {
        userId: source.ownerId,
        feature: "item_generation",
        schema: mcqDraftSchema,
        instructions: MCQ_INSTRUCTIONS,
        prompt: mcqPrompt(chunk),
      });
      const item = buildMcqItem(object, chunk.id, deps.clock.now());
      if (!item) {
        result.chunksPending++;
      } else if (await saveItem(deps.db, item)) {
        result.itemsCreated++;
      } else {
        result.itemsSkipped++;
      }
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        result.budgetExhausted = true;
        result.chunksPending++;
      } else if (NoObjectGeneratedError.isInstance(error)) {
        // An unusable reply: its cost is logged, and the chunk is tried again next run.
        result.chunksPending++;
      } else {
        throw error;
      }
    }
  }
  return result;
}
