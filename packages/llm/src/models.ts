import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/** What a call is for; stored as `llm_usage.feature`. Later: "chat", "ghost_text", "grading". */
export type LlmFeature = "item_generation";

/** A model object, never a bare id string, so its `modelId` can be priced and logged. */
export type Model = Exclude<LanguageModel, string>;

/**
 * The model each feature uses. Chosen here, never by callers, so the provider can change in one
 * place (build-plan §10.6). Each must have a price in prices.ts.
 */
export const MODEL_IDS: Record<LlmFeature, string> = {
  item_generation: "gemini-3.5-flash",
};

/** The production model for a feature. Reads GOOGLE_GENERATIVE_AI_API_KEY when it is called. */
export function defaultModel(feature: LlmFeature): Model {
  return google(MODEL_IDS[feature]);
}
