import { type Database, syntheticUsers } from "@repo/db";

/**
 * Every row the generator is responsible for, for V7: the synthetic users and everything they own,
 * each table in a fixed order. Left out, as REQ §6 allows, only what is not the generator's to
 * fix: review_sessions.id and exams.id, which the engine mints (Prisma's uuid()), and the demo
 * account's password hash, which Better Auth salts. An exam id is replaced, wherever it appears
 * (the exam row, a session's plan and meta), by a label made of its user and created_at.
 */
export async function snapshot(db: Database) {
  const user = syntheticUsers();
  const owned = { user };
  const [
    users,
    settings,
    accounts,
    documents,
    sources,
    chunks,
    items,
    reviews,
    cards,
    sessions,
    exams,
  ] = await Promise.all([
    db.user.findMany({ where: user, orderBy: { id: "asc" } }),
    db.revisionSettings.findMany({ where: owned, orderBy: { userId: "asc" } }),
    db.account.findMany({
      where: owned,
      orderBy: { id: "asc" },
      select: { id: true, userId: true, accountId: true, providerId: true, createdAt: true },
    }),
    db.document.findMany({ where: { owner: user }, orderBy: { id: "asc" } }),
    db.source.findMany({ where: { owner: user }, orderBy: { id: "asc" } }),
    db.chunk.findMany({ where: { source: { owner: user } }, orderBy: { id: "asc" } }),
    db.item.findMany({
      where: { sourceChunk: { source: { owner: user } } },
      orderBy: { id: "asc" },
    }),
    db.reviewLog.findMany({ where: owned, orderBy: { id: "asc" } }),
    db.cardState.findMany({ where: owned, orderBy: [{ userId: "asc" }, { itemId: "asc" }] }),
    db.reviewSession.findMany({ where: owned, orderBy: [{ userId: "asc" }, { localDate: "asc" }] }),
    db.exam.findMany({ where: owned, orderBy: [{ userId: "asc" }, { createdAt: "asc" }] }),
  ]);

  const label = new Map(
    exams.map((exam) => [exam.id, `exam:${exam.userId}:${exam.createdAt.toISOString()}`]),
  );
  const relabel = (value: unknown) => {
    let json = JSON.stringify(value);
    for (const [id, name] of label) json = json.replaceAll(id, name);
    return JSON.parse(json) as unknown;
  };

  return {
    users,
    settings,
    accounts,
    documents,
    sources,
    chunks,
    items,
    reviews,
    cards,
    // Not the id: the engine mints it.
    sessions: sessions.map(
      ({ userId, localDate, budgetSec, plan, meta, extendedCount, createdAt }) => ({
        userId,
        localDate,
        budgetSec,
        plan: relabel(plan),
        meta: relabel(meta),
        extendedCount,
        createdAt,
      }),
    ),
    exams: exams.map(({ id, ...rest }) => ({ ...rest, id: label.get(id) })),
  };
}
