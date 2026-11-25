import { defineConfig } from "vitest/config";

// Performance budgets only (*.perf.int.test.ts), against a real Postgres like the integration
// tests. Run on their own (`npm run test:perf`, a separate CI step after the integration tests),
// so no other test file competes for the CPU and the database while the timings are taken.
export default defineConfig({
  test: {
    include: ["src/**/*.perf.int.test.ts"],
    globalSetup: ["./src/test/database.ts"],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
