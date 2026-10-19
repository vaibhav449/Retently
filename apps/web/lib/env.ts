import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Signs session cookies. Generate with: openssl rand -hex 32 */
  BETTER_AUTH_SECRET: z.string().min(32),
  /** The public URL of the web app, e.g. http://localhost:3000 */
  BETTER_AUTH_URL: z.url(),
  /** Shared with apps/realtime. Generate with: openssl rand -hex 32 */
  REALTIME_TOKEN_SECRET: z.string().min(32),
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
