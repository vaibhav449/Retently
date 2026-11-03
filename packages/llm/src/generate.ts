import type { Database } from "@repo/db";
import { generateText, type LanguageModelUsage, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";
import { assertWithinBudget } from "./budget";
import type { LlmFeature, Model } from "./models";
import { costUsd, priceOf } from "./prices";

export interface Clock {
  now(): Date;
}

export interface LlmDeps {
  db: Database;
  clock: Clock;
  /** What one user's calls may cost per local day, in USD. */
  dailyBudgetUsd: number;
  /** The model for a feature: defaultModel in production, a mock in tests. */
  model: (feature: LlmFeature) => Model;
}

export interface StructuredRequest<T> {
  userId: string;
  feature: LlmFeature;
  /** The object the model must return; the reply is validated against it. */
  schema: z.ZodType<T>;
  /** Instructions, kept separate from the user content in `prompt`. */
  instructions: string;
  prompt: string;
  maxOutputTokens?: number;
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface StructuredResult<T> {
  object: T;
  usage: CallUsage;
}

/** Writes the `llm_usage` row for one call and returns what it cost. */
async function logUsage(
  deps: LlmDeps,
  call: { userId: string; feature: LlmFeature; modelId: string; usage: LanguageModelUsage },
  at: Date,
): Promise<CallUsage> {
  const inputTokens = call.usage.inputTokens ?? 0;
  const outputTokens = call.usage.outputTokens ?? 0;
  const cost = costUsd(call.modelId, { inputTokens, outputTokens }, at);
  await deps.db.llmUsage.create({
    data: {
      userId: call.userId,
      feature: call.feature,
      model: call.modelId,
      inputTokens,
      outputTokens,
      costUsd: cost.toFixed(6),
      createdAt: at,
    },
  });
  return { inputTokens, outputTokens, costUsd: cost };
}

/**
 * The one way to ask a model for a structured object. It refuses the call once the user's daily
 * budget is spent (BudgetExceededError), checks the model has a price, and writes one `llm_usage`
 * row per call, including a call whose reply did not match the schema, since its tokens were
 * still billed.
 */
export async function generateStructured<T>(
  deps: LlmDeps,
  request: StructuredRequest<T>,
): Promise<StructuredResult<T>> {
  const now = deps.clock.now();
  const model = deps.model(request.feature);
  // Fails before spending anything if the model has no price.
  priceOf(model.modelId, now);
  await assertWithinBudget(deps.db, request.userId, deps.dailyBudgetUsd, now);

  const call = { userId: request.userId, feature: request.feature, modelId: model.modelId };
  try {
    const result = await generateText({
      model,
      instructions: request.instructions,
      prompt: request.prompt,
      output: Output.object({ schema: request.schema }),
      maxOutputTokens: request.maxOutputTokens,
    });
    const usage = await logUsage(deps, { ...call, usage: result.totalUsage }, now);
    return { object: result.output, usage };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) && error.usage) {
      await logUsage(deps, { ...call, usage: error.usage }, now);
    }
    throw error;
  }
}
