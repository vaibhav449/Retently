import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Shared with apps/web, which signs the tokens this server verifies. */
  REALTIME_TOKEN_SECRET: z.string().min(32),
  /** Where the worker's events come from; they are forwarded to each user's sockets. */
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
