import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Signs session cookies. Generate with: openssl rand -hex 32 */
  BETTER_AUTH_SECRET: z.string().min(32),
  /** The public URL of the web app, e.g. http://localhost:3000 */
  BETTER_AUTH_URL: z.url(),
  /** Shared with apps/realtime. Generate with: openssl rand -hex 32 */
  REALTIME_TOKEN_SECRET: z.string().min(32),
  /** Signs the presentation token of each review question. Web only. Generate with: openssl rand -hex 32 */
  REVIEW_TOKEN_SECRET: z.string().min(32),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Read lazily, on first use, so `next build` can import route modules
 * without production secrets present in the build environment.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  cached = result.data;
  return cached;
}

const jobsEnvSchema = z.object({
  /** The broker the "Generate questions" route publishes to, e.g. amqp://app:app@127.0.0.1:5672 */
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
});

export type JobsEnv = z.infer<typeof jobsEnvSchema>;

/**
 * Kept apart from getServerEnv() so that a missing broker URL turns off question generation (the
 * route answers 503), not the whole app. Production can't forget it: compose requires it.
 */
export function getJobsEnv(): JobsEnv {
  const result = jobsEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid jobs environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
