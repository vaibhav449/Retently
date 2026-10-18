import { z } from "zod";

const envSchema = z.object({
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  HEALTH_PORT: z.coerce.number().int().positive().default(4001),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
