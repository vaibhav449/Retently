import { defineConfig } from "vitest/config";

// Tests against a real RabbitMQ and Postgres: a throwaway vhost and database per run, created and
// deleted by the setups. The files share the vhost's queues, so they run one at a time.
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    globalSetup: ["./src/test/vhost.ts", "./src/test/database.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
