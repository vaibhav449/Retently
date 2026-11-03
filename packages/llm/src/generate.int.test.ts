import { randomUUID } from "node:crypto";
import { createDb, type Database } from "@repo/db";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { BudgetExceededError, spentTodayUsd } from "./budget";
import { generateStructured, type LlmDeps } from "./generate";
import { UnknownModelPriceError } from "./prices";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = createDb(inject("databaseUrl")));
});

afterAll(() => close());

const NOW = new Date("2026-11-03T10:00:00Z");
const clock = { now: () => NOW };

const answerSchema = z.object({ answer: z.string() });

/** A model that replies `text` and reports 1,000 input and 500 output tokens. */
function mockModel(text: string, modelId = "gemini-3.5-flash") {
  return new MockLanguageModelV4({
    modelId,
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "STOP" },
      usage: {
        inputTokens: { total: 1_000, noCache: 1_000, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 500, text: 500, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

function depsWith(model: MockLanguageModelV4, dailyBudgetUsd = 0.5): LlmDeps {
  return { db, clock, dailyBudgetUsd, model: () => model };
}

async function seedUser(): Promise<string> {
  const id = `user_${randomUUID()}`;
  await db.user.create({
    data: { id, name: "Test", email: `${id}@example.com`, dob: new Date("2000-01-01") },
  });
  return id;
}

const request = (userId: string) => ({
  userId,
  feature: "item_generation" as const,
  schema: answerSchema,
  instructions: "Answer in one word.",
  prompt: "Which organelle makes most of the cell's ATP?",
});

describe("generateStructured", () => {
  it("returns the parsed object and writes one llm_usage row", async () => {
    const userId = await seedUser();
    const model = mockModel(JSON.stringify({ answer: "Mitochondrion" }));

    const result = await generateStructured(depsWith(model), request(userId));

    expect(result.object).toEqual({ answer: "Mitochondrion" });
    // 1,000 × $0.75/M + 500 × $3.75/M
    expect(result.usage).toEqual({ inputTokens: 1_000, outputTokens: 500, costUsd: 0.002625 });
    const rows = await db.llmUsage.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: "item_generation",
      model: "gemini-3.5-flash",
      inputTokens: 1_000,
      outputTokens: 500,
      createdAt: NOW,
    });
    expect(Number(rows[0]?.costUsd)).toBe(0.002625);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("refuses a call once the day's budget is spent, without calling the model", async () => {
    const userId = await seedUser();
    await db.llmUsage.create({
      data: {
        userId,
        feature: "item_generation",
        model: "gemini-3.5-flash",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: "0.500000",
        createdAt: new Date("2026-11-03T09:00:00Z"),
      },
    });
    const model = mockModel(JSON.stringify({ answer: "Mitochondrion" }));

    const refused = generateStructured(depsWith(model, 0.5), request(userId));

    await expect(refused).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(refused).rejects.toMatchObject({ spentUsd: 0.5, budgetUsd: 0.5 });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(await db.llmUsage.count({ where: { userId } })).toBe(1);
  });

  it("counts only today's spend in the user's time zone", async () => {
    const userId = await seedUser();
    // 18:00 UTC on 2 Nov is 23:30 on 2 Nov in India: yesterday. 19:00 UTC is 00:30 on 3 Nov: today.
    for (const [createdAt, costUsd] of [
      ["2026-11-02T18:00:00Z", "0.400000"],
      ["2026-11-02T19:00:00Z", "0.100000"],
    ] as const) {
      await db.llmUsage.create({
        data: {
          userId,
          feature: "item_generation",
          model: "gemini-3.5-flash",
          inputTokens: 0,
          outputTokens: 0,
          costUsd,
          createdAt: new Date(createdAt),
        },
      });
    }

    expect(await spentTodayUsd(db, userId, NOW)).toBe(0.1);
    // The same rows in UTC are both on 2 Nov: nothing spent on 3 Nov.
    await db.revisionSettings.create({ data: { userId, timezone: "UTC" } });
    expect(await spentTodayUsd(db, userId, NOW)).toBe(0);
  });

  it("logs the tokens of a reply that does not match the schema, then throws", async () => {
    const userId = await seedUser();
    const model = mockModel("not json");

    await expect(generateStructured(depsWith(model), request(userId))).rejects.toThrow();

    const rows = await db.llmUsage.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputTokens: 1_000, outputTokens: 500 });
  });

  it("refuses a model with no price before calling it", async () => {
    const userId = await seedUser();
    const model = mockModel(JSON.stringify({ answer: "x" }), "unpriced-model");

    await expect(generateStructured(depsWith(model), request(userId))).rejects.toBeInstanceOf(
      UnknownModelPriceError,
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
