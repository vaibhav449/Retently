// The access rules live in packages/db; they are tested here, next to the Postgres test harness.
import { randomUUID } from "node:crypto";
import { canAccessSource, createDb, type Database, itemsReadableBy } from "@repo/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { seedUserWithMcq } from "./test/seed";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = createDb(inject("databaseUrl")));
});

afterAll(() => close());

describe("access rules (packages/db)", () => {
  it("lets the owner read a source, and nobody else", async () => {
    const owner = await seedUserWithMcq(db);
    const other = await seedUserWithMcq(db);
    const { sourceId } = await db.chunk.findUniqueOrThrow({
      where: { id: owner.chunkId },
      select: { sourceId: true },
    });

    expect(await canAccessSource(db, owner.userId, sourceId)).toBe(true);
    expect(await canAccessSource(db, other.userId, sourceId)).toBe(false);
    expect(await canAccessSource(db, owner.userId, randomUUID())).toBe(false);
  });

  it("lists only the items a user can read", async () => {
    const owner = await seedUserWithMcq(db);
    await seedUserWithMcq(db); // someone else's notes, which must not appear
    const items = await db.item.findMany({
      where: itemsReadableBy(owner.userId),
      select: { id: true },
    });
    expect(items.map((item) => item.id)).toEqual([owner.itemId]);
  });
});
