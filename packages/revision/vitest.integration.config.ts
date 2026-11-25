import { defineConfig } from "vitest/config";

// Tests against a real Postgres: a throwaway database per run, created and dropped by the setup.
// Performance budgets are left out: they run alone, through vitest.perf.config.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    exclude: ["src/**/*.perf.int.test.ts"],
    globalSetup: ["./src/test/database.ts"],
    testTimeout: 20_000,
  },
});
