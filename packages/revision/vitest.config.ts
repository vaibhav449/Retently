import { configDefaults, defineConfig } from "vitest/config";

// Unit tests only. Tests that need Postgres are *.int.test.ts: `npm run test:integration`.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.int.test.ts"],
    // The seeded property suites (exam mode, the selection) run thousands of scheduler calls:
    // well under a second here, but several on a loaded machine or a slow CI runner.
    testTimeout: 30_000,
  },
});
