import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

// Resolved from this file, so it works both from src/ (tsx) and from dist/ (Docker image).
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log("Migrations applied");
} finally {
  await client.end();
}
