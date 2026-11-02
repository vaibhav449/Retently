import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createDb } from "@repo/db";
import { createDefaultRegistry } from "../config";
import { checkCardState, rebuildAll } from "./replay";

/**
 * npm run engine:rebuild: replay every card's log through the active scheduler.
 * npm run engine:check:   verify invariant I2 without writing; exits 1 on any mismatch.
 */
const command = process.argv[2];
if (command !== "rebuild" && command !== "check") {
  console.error("Usage: tsx src/rebuild/cli.ts <rebuild|check>");
  process.exit(2);
}

const envFile = fileURLToPath(new URL("../../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) loadEnvFile(envFile);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set: run `npm run infra:up` and check the root .env");
  process.exit(2);
}

const { db, close } = createDb(databaseUrl);
const registry = createDefaultRegistry();
try {
  if (command === "rebuild") {
    const { cards, changed } = await rebuildAll({ db, registry });
    console.log(`Replayed ${cards} cards with ${registry.active.version}; ${changed} changed.`);
  } else {
    const versions = await db.cardState.groupBy({ by: ["schedulerVersion"], _count: true });
    const counts = versions.map((v) => `${v.schedulerVersion}: ${v._count}`).join(", ");
    console.log(`card_state by scheduler: ${counts || "no cards yet"}`);

    const mismatches = await checkCardState({ db, registry });
    for (const m of mismatches) console.error(`MISMATCH ${m.userId} / ${m.itemId}: ${m.problem}`);
    if (mismatches.length > 0) {
      console.error(`${mismatches.length} cards do not match the replay of their log.`);
      process.exitCode = 1;
    } else {
      console.log("Every card matches the replay of its log.");
    }
  }
} finally {
  await close();
}
