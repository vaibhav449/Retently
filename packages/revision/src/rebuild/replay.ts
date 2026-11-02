import { isDeepStrictEqual } from "node:util";
import type { Database } from "@repo/db";
import { type CardState, type LoggedReview, replay, type SchedulerRegistry } from "@repo/scheduler";
import { lockCard } from "../record/lock";
import { asGrade, dueDateOf } from "../record/recordReview";

export interface RebuildDeps {
  db: Database;
  registry: SchedulerRegistry;
}

export interface RebuildSummary {
  /** Cards replayed. */
  cards: number;
  /** Cards whose stored row was different (or missing) before. */
  changed: number;
}

/** A card whose stored state is not the replay of its log (invariant I2, 03-data-model.md §5). */
export interface CardMismatch {
  userId: string;
  itemId: string;
  problem: string;
}

/** The log of one card in replay order: (reviewed_at, id). Duel answers count too (05 §9). */
async function logOf(
  tx: Pick<Database, "reviewLog">,
  userId: string,
  itemId: string,
): Promise<LoggedReview[]> {
  const rows = await tx.reviewLog.findMany({
    where: { userId, itemId },
    orderBy: [{ reviewedAt: "asc" }, { id: "asc" }],
    select: { grade: true, reviewedAt: true },
  });
  // The logged grade, never a re-mapped one (03 §6).
  return rows.map((row) => ({ grade: asGrade(row.grade), reviewedAt: row.reviewedAt }));
}

/**
 * Rewrites the card_state of every card `userId` has answered, replaying each card's log through
 * the ACTIVE scheduler (03-data-model.md §6). This is how a scheduler change reaches stored cards:
 * placeholder-v0 → fsrs6-v1 now, fsrs6-v2 later. Running it again changes nothing.
 */
export async function rebuildCardState(userId: string, deps: RebuildDeps): Promise<RebuildSummary> {
  const cards = await deps.db.reviewLog.findMany({
    where: { userId },
    distinct: ["itemId"],
    orderBy: { itemId: "asc" },
    select: { itemId: true },
  });
  let changed = 0;
  for (const { itemId } of cards) {
    if (await rebuildCard(userId, itemId, deps)) changed++;
  }
  return { cards: cards.length, changed };
}

/** rebuildCardState() for every user with at least one answer. */
export async function rebuildAll(deps: RebuildDeps): Promise<RebuildSummary> {
  const users = await deps.db.reviewLog.findMany({
    distinct: ["userId"],
    orderBy: { userId: "asc" },
    select: { userId: true },
  });
  const total: RebuildSummary = { cards: 0, changed: 0 };
  for (const { userId } of users) {
    const summary = await rebuildCardState(userId, deps);
    total.cards += summary.cards;
    total.changed += summary.changed;
  }
  return total;
}

/** Replays one card under its lock, so a live answer can't interleave. True if the row changed. */
async function rebuildCard(userId: string, itemId: string, deps: RebuildDeps): Promise<boolean> {
  const scheduler = deps.registry.active;
  const card = { userId, itemId };
  return deps.db.$transaction(async (tx) => {
    await lockCard(tx, userId, itemId);
    const log = await logOf(tx, userId, itemId);
    const last = log.at(-1);
    if (!last) return false;

    const state = replay(scheduler, log);
    const written = {
      schedulerVersion: scheduler.version,
      state: { ...state },
      dueAt: dueDateOf(state, scheduler.version),
      // Exactly what recordReview() writes after the last answer, so I2 holds either way.
      misconceptionUntil: null,
      updatedAt: last.reviewedAt,
    };
    const stored = await tx.cardState.findUnique({ where: { userId_itemId: card } });
    const unchanged =
      stored !== null &&
      stored.schedulerVersion === written.schedulerVersion &&
      isDeepStrictEqual(stored.state, written.state) &&
      stored.dueAt.getTime() === written.dueAt.getTime() &&
      stored.misconceptionUntil === null &&
      stored.updatedAt.getTime() === written.updatedAt.getTime();
    if (unchanged) return false;

    await tx.cardState.upsert({
      where: { userId_itemId: card },
      create: { ...card, ...written },
      update: written,
    });
    return true;
  });
}

/**
 * Invariant I2: every card_state row equals the replay of its log through the scheduler named in
 * the row, and every answered card has a row. Writes nothing. Each card is read under its lock,
 * so an answer recorded during the check can't show up as a false mismatch.
 */
export async function checkCardState(deps: RebuildDeps): Promise<CardMismatch[]> {
  const [stored, logged] = await Promise.all([
    deps.db.cardState.findMany({ select: { userId: true, itemId: true } }),
    deps.db.reviewLog.findMany({
      distinct: ["userId", "itemId"],
      select: { userId: true, itemId: true },
    }),
  ]);
  const cards = new Map<string, { userId: string; itemId: string }>();
  for (const card of [...stored, ...logged]) cards.set(`${card.userId}:${card.itemId}`, card);

  const mismatches: CardMismatch[] = [];
  for (const { userId, itemId } of [...cards.values()].sort(byCard)) {
    const problem = await checkCard(userId, itemId, deps);
    if (problem) mismatches.push({ userId, itemId, problem });
  }
  return mismatches;
}

async function checkCard(
  userId: string,
  itemId: string,
  deps: RebuildDeps,
): Promise<string | null> {
  return deps.db.$transaction(async (tx) => {
    await lockCard(tx, userId, itemId);
    const [row, log] = await Promise.all([
      tx.cardState.findUnique({ where: { userId_itemId: { userId, itemId } } }),
      logOf(tx, userId, itemId),
    ]);
    if (!row) return "answered, but has no card_state";
    if (log.length === 0) return "card_state without any review_log rows";

    let expected: CardState;
    try {
      expected = replay(deps.registry.get(row.schedulerVersion), log);
    } catch (error) {
      return `cannot replay with ${row.schedulerVersion}: ${String(error)}`;
    }
    if (!isDeepStrictEqual(row.state, { ...expected })) {
      return `state differs from the replay with ${row.schedulerVersion}`;
    }
    if (row.dueAt.getTime() !== dueDateOf(expected, row.schedulerVersion).getTime()) {
      return "due_at differs from the replayed state";
    }
    return null;
  });
}

function byCard(a: { userId: string; itemId: string }, b: { userId: string; itemId: string }) {
  return a.userId.localeCompare(b.userId) || a.itemId.localeCompare(b.itemId);
}
