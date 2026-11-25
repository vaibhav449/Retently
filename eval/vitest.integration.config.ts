import { defineConfig } from "vitest/config";

// Against a real Postgres: a throwaway database per run, created and dropped by the setup. Each
// suite seeds whole cohorts through the engine, so the timeouts are minutes, not seconds, and the
// files run one at a time (they share that one database).
export default defineConfig({
  test: {
    include: ["synth/**/*.int.test.ts"],
    globalSetup: ["./test/database.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
