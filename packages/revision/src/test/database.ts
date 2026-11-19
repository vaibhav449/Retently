import { existsSync, readdirSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const envFile = fileURLToPath(new URL("../../../../.env", import.meta.url));
const migrations = fileURLToPath(new URL("../../../db/prisma/migrations", import.meta.url));

/**
 * Vitest global setup for *.int.test.ts: creates a throwaway database on the Postgres in
 * DATABASE_URL, applies every migration, hands its URL to the tests and drops it afterwards.
 * The database DATABASE_URL names is never touched.
 */
export default async function setup(project: TestProject) {
  if (!process.env.DATABASE_URL && existsSync(envFile)) loadEnvFile(envFile);
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      "Integration tests need Postgres: run `npm run infra:up` (DATABASE_URL in .env)",
    );
  }

  const scratch = await createMigratedDatabase(
    baseUrl,
    `revision_test_${Date.now()}_${process.pid}`,
  );
  project.provide("databaseUrl", scratch.url);
  return scratch.drop;
}

/**
 * A new database named `name` on the server of `adminUrl`, with every migration applied. `drop`
 * removes it. Also used by tests that need a database of their own (the performance test).
 */
export async function createMigratedDatabase(
  adminUrl: string,
  name: string,
): Promise<{ url: string; drop: () => Promise<void> }> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  const folders = readdirSync(migrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    await client.query(readFileSync(`${migrations}/${folder}/migration.sql`, "utf8"));
  }
  await client.end();

  return {
    url: url.toString(),
    drop: async () => {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
