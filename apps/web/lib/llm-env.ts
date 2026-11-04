import { z } from "zod";

const llmEnvSchema = z.object({
  /** A Google AI Studio key. Optional so the app runs without one; generating questions needs it. */
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  /** What one student's LLM calls may cost per day, in USD. */
  LLM_DAILY_BUDGET_USD: z.coerce.number().positive().default(0.5),
});

export type LlmEnv = z.infer<typeof llmEnvSchema>;

/**
 * Kept apart from getServerEnv() so that a missing LLM key turns off question generation, not the
 * whole app. The key itself is read by @ai-sdk/google; it is checked here only to answer clearly.
 */
export function getLlmEnv(): LlmEnv {
  const result = llmEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid LLM environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
