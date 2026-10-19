import { createDb, type Database } from "@repo/db";
import { getServerEnv } from "./env";

// One client per process. In development, hot reload re-runs this module,
// so the client is kept on globalThis to avoid opening a new pool each time.
const globalForDb = globalThis as { retentlyDb?: Database };

export function getDb(): Database {
  globalForDb.retentlyDb ??= createDb(getServerEnv().DATABASE_URL).db;
  return globalForDb.retentlyDb;
}
