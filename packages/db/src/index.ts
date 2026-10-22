import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export function createDb(url: string) {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return {
    db,
    close: () => db.$disconnect(),
  };
}

export type Database = ReturnType<typeof createDb>["db"];

export { canAccessSource, itemsReadableBy } from "./access";
