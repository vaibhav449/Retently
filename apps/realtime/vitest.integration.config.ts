import { defineConfig } from "vitest/config";

// Tests against a real RabbitMQ: a throwaway vhost per run, created and deleted by the setup.
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    globalSetup: ["./src/test/vhost.ts"],
    testTimeout: 30_000,
  },
});
