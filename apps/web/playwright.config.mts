import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Locally the dev server reads .env.local, and the tests read the same file so that they seed and
// check the same database. In CI the job sets the variables instead.
const envFile = path.join(import.meta.dirname, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const baseURL = "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  // Not *.test.ts, which Vitest would pick up.
  testMatch: "**/*.e2e.mts",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The dev server compiles each page and route on its first request, which is slow on CI runners.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
