import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Client generation works without a database; migration commands require DATABASE_URL.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
