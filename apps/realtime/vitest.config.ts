import { configDefaults, defineConfig } from "vitest/config";

// Unit tests only. Tests that need RabbitMQ are *.int.test.ts: `npm run test:integration`.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.int.test.ts"],
  },
});
