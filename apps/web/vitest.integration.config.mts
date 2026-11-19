import { defineConfig } from "vitest/config";

// Tests against a real RabbitMQ: a throwaway vhost per run, created and deleted by the setup.
export default defineConfig({
  test: {
    include: ["lib/**/*.int.test.ts"],
    globalSetup: ["@repo/messaging/testing"],
    testTimeout: 30_000,
  },
});
