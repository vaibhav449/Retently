import { defineConfig } from "vitest/config";

// Tests against a real Postgres: a throwaway database per run, created and dropped by the setup.
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    globalSetup: ["./src/test/database.ts"],
    testTimeout: 20_000,
  },
});
