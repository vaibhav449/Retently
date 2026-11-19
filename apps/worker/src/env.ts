import { z } from "zod";

const MISSING_KEY =
  "GOOGLE_GENERATIVE_AI_API_KEY is required: the worker generates questions with Gemini. " +
  "Get a key at https://aistudio.google.com/apikey and put it in .env.";

const envSchema = z.object({
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  /** Ingestion reads and writes sources, chunks and items. */
  DATABASE_URL: z.string().min(1),
  HEALTH_PORT: z.coerce.number().int().positive().default(4001),
  /**
   * A Google AI Studio key. Required: without it every job would fail and be parked, so the
   * worker refuses to start instead. @ai-sdk/google reads it from process.env itself.
   */
  GOOGLE_GENERATIVE_AI_API_KEY: z.string({ error: MISSING_KEY }).trim().min(1, MISSING_KEY),
  /** What one student's LLM calls may cost per local day, in USD. */
  LLM_DAILY_BUDGET_USD: z.coerce.number().positive().default(0.5),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
