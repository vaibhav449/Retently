import { randomUUID } from "node:crypto";
import { createDb, type Database } from "@repo/db";
import { presentNext } from "@repo/revision";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { type IngestDeps, IngestError, ingestSource } from "./ingest";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = createDb(inject("databaseUrl")));
});

afterAll(() => close());

const NOW = new Date("2026-11-03T10:00:00Z");
const clock = { now: () => NOW };
/** What one mocked call costs: 1,000 × $0.75/M + 500 × $3.75/M. */
const CALL_COST = 0.002625;

const MITOCHONDRIA =
  "Mitochondria are the site of aerobic respiration. They make most of the cell's ATP, so muscle cells have many of them.";
const NUCLEUS =
  "The nucleus holds the cell's DNA and controls which proteins the cell makes. A double membrane surrounds it.";
const MEMBRANE =
  "The cell membrane is a phospholipid bilayer. Small non-polar molecules cross it freely, while ions need channel proteins.";

const note = (...sections: string[]) =>
  sections.map((text, i) => `## Section ${i + 1}\n\n${text}`).join("\n\n");

type Reply = string | (() => string);

/** A model that answers each call with the next reply, or a fresh valid MCQ once they run out. */
function mockModel(replies: Reply[] = []) {
  let call = 0;
  return new MockLanguageModelV4({
    modelId: "gemini-3.5-flash",
    doGenerate: () => {
      call++;
      const reply = replies[call - 1];
      const text =
        typeof reply === "function"
          ? reply()
          : (reply ??
            JSON.stringify({
              question: `Question ${call}?`,
              correct_answer: `Right ${call}`,
              wrong_answers: [`Wrong ${call}a`, `Wrong ${call}b`, `Wrong ${call}c`],
            }));
      return Promise.resolve({
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "STOP" },
        usage: {
          inputTokens: {
            total: 1_000,
            noCache: 1_000,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 500, text: 500, reasoning: undefined },
        },
        warnings: [],
      });
    },
  });
}

function depsWith(model: MockLanguageModelV4, overrides: Partial<IngestDeps> = {}): IngestDeps {
  return {
    db,
    clock,
    dailyBudgetUsd: 0.5,
    model: () => model,
    ...overrides,
  };
}

/** A user with one note holding `markdown`, as A1 creates it: the source comes with the document. */
async function seedNote(markdown: string) {
  const userId = `user_${randomUUID()}`;
  await db.user.create({
    data: { id: userId, name: "Test", email: `${userId}@example.com`, dob: new Date("2000-01-01") },
  });
  const document = await db.document.create({
    data: {
      ownerId: userId,
      title: "Cells",
      contentMd: markdown,
      source: { create: { ownerId: userId, kind: "note", title: "Cells" } },
    },
    select: { id: true, source: { select: { id: true } } },
  });
  return { userId, documentId: document.id, sourceId: document.source?.id ?? "" };
}

const liveItems = (sourceId: string) =>
  db.item.findMany({
    where: { retiredAt: null, sourceChunk: { sourceId } },
    include: { sourceChunk: { select: { text: true } } },
  });

describe("ingestSource", () => {
  it("makes one MCQ per chunk, and /review serves them", async () => {
    const { userId, sourceId } = await seedNote(note(MITOCHONDRIA, NUCLEUS, MEMBRANE));
    const model = mockModel();

    const result = await ingestSource(sourceId, depsWith(model));

    expect(result).toEqual({
      chunks: 3,
      itemsCreated: 3,
      itemsSkipped: 0,
      budgetExhausted: false,
      chunksPending: 0,
    });
    const items = await liveItems(sourceId);
    expect(items.map((item) => item.sourceChunk.text).sort()).toEqual(
      [MITOCHONDRIA, NUCLEUS, MEMBRANE].sort(),
    );
    for (const item of items) {
      expect(item.type).toBe("mcq");
      const options = item.options as { id: string; text: string }[];
      expect(options.find((option) => option.id === item.answerOptionId)?.text).toBe(item.answer);
    }
    expect(await db.llmUsage.count({ where: { userId, feature: "item_generation" } })).toBe(3);

    const next = await presentNext(userId, { db, clock, tokenSecret: "x".repeat(32) });
    expect(next.state).toBe("ok");
    if (next.state === "ok") {
      expect(items.map((item) => item.prompt)).toContain(next.item.item.prompt);
      expect(next.item.category).toBe("new");
    }
  });

  it("creates nothing and calls no model on a second run", async () => {
    const { sourceId } = await seedNote(note(MITOCHONDRIA, NUCLEUS));
    const model = mockModel();
    await ingestSource(sourceId, depsWith(model));

    const again = await ingestSource(sourceId, depsWith(model));

    expect(again).toEqual({
      chunks: 2,
      itemsCreated: 0,
      itemsSkipped: 2,
      budgetExhausted: false,
      chunksPending: 0,
    });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(await db.chunk.count({ where: { sourceId } })).toBe(2);
  });

  it("asks again only for an edited paragraph, and revives it when the edit is undone", async () => {
    const { documentId, sourceId } = await seedNote(note(MITOCHONDRIA, NUCLEUS));
    const model = mockModel();
    await ingestSource(sourceId, depsWith(model));
    const [before] = (await liveItems(sourceId)).filter(
      (item) => item.sourceChunk.text === NUCLEUS,
    );

    const edited = `${NUCLEUS} Pores in it let RNA out.`;
    await db.document.update({
      where: { id: documentId },
      data: { contentMd: note(MITOCHONDRIA, edited) },
    });
    const afterEdit = await ingestSource(sourceId, depsWith(model));

    expect(afterEdit).toMatchObject({ chunks: 2, itemsCreated: 1, itemsSkipped: 1 });
    expect(model.doGenerateCalls).toHaveLength(3);
    expect((await liveItems(sourceId)).map((item) => item.sourceChunk.text).sort()).toEqual(
      [MITOCHONDRIA, edited].sort(),
    );
    // The old question is retired with its chunk, not deleted, so its reviews keep their citation.
    expect(await db.item.findUniqueOrThrow({ where: { id: before?.id } })).toMatchObject({
      retiredAt: NOW,
    });

    await db.document.update({
      where: { id: documentId },
      data: { contentMd: note(MITOCHONDRIA, NUCLEUS) },
    });
    const undone = await ingestSource(sourceId, depsWith(model));

    expect(undone).toMatchObject({ chunks: 2, itemsCreated: 0, itemsSkipped: 2 });
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(await db.item.findUniqueOrThrow({ where: { id: before?.id } })).toMatchObject({
      retiredAt: null,
    });
  });

  it("stops cleanly when the budget runs out, keeping what it made", async () => {
    const { sourceId } = await seedNote(note(MITOCHONDRIA, NUCLEUS, MEMBRANE));
    const model = mockModel();

    // The first call is within budget; it spends the whole budget, so the second is refused.
    const result = await ingestSource(sourceId, depsWith(model, { dailyBudgetUsd: CALL_COST }));

    expect(result).toEqual({
      chunks: 3,
      itemsCreated: 1,
      itemsSkipped: 0,
      budgetExhausted: true,
      chunksPending: 2,
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(await liveItems(sourceId)).toHaveLength(1);
  });

  it("caps the chunks per run, and the next run goes on", async () => {
    const { sourceId } = await seedNote(note(MITOCHONDRIA, NUCLEUS, MEMBRANE));
    const model = mockModel();

    const first = await ingestSource(sourceId, depsWith(model, { maxChunksPerRun: 2 }));
    const second = await ingestSource(sourceId, depsWith(model, { maxChunksPerRun: 2 }));

    expect(first).toMatchObject({ itemsCreated: 2, chunksPending: 1 });
    expect(second).toMatchObject({ itemsCreated: 1, itemsSkipped: 2, chunksPending: 0 });
    expect(await liveItems(sourceId)).toHaveLength(3);
  });

  it("leaves a chunk pending when the reply is unusable, and goes on with the rest", async () => {
    const { userId, sourceId } = await seedNote(note(MITOCHONDRIA, NUCLEUS));
    const unfair = JSON.stringify({
      question: "Which is right?",
      correct_answer: "Nucleus",
      wrong_answers: ["nucleus", "Ribosome"],
    });
    const model = mockModel(["not json", unfair]);

    const result = await ingestSource(sourceId, depsWith(model));

    expect(result).toMatchObject({ chunks: 2, itemsCreated: 0, chunksPending: 2 });
    // Both calls were billed, so both are logged.
    expect(await db.llmUsage.count({ where: { userId } })).toBe(2);

    const retry = await ingestSource(sourceId, depsWith(model));
    expect(retry).toMatchObject({ itemsCreated: 2, chunksPending: 0 });
  });

  it("makes no chunks from a note too short to ask about", async () => {
    const { sourceId } = await seedNote("# Todo\n\nRevise this.");
    const model = mockModel();

    expect(await ingestSource(sourceId, depsWith(model))).toMatchObject({
      chunks: 0,
      itemsCreated: 0,
    });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("refuses a missing source and a PDF", async () => {
    const model = mockModel();
    await expect(ingestSource(randomUUID(), depsWith(model))).rejects.toMatchObject({
      code: "source_not_found",
    });

    const { userId } = await seedNote("");
    const pdf = await db.source.create({
      data: { ownerId: userId, kind: "pdf", fileKey: "notes.pdf", title: "Notes" },
    });
    await expect(ingestSource(pdf.id, depsWith(model))).rejects.toBeInstanceOf(IngestError);
  });
});
