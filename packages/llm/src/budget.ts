import type { Database } from "@repo/db";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "./day";

/** The user has spent their daily LLM budget. Retrying today will not help. */
export class BudgetExceededError extends Error {
  readonly code = "llm_budget_exceeded";

  constructor(
    readonly spentUsd: number,
    readonly budgetUsd: number,
  ) {
    super(`Daily LLM budget spent: $${spentUsd.toFixed(4)} of $${budgetUsd.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

/**
 * What the user's LLM calls have cost since their local midnight (their revision settings' time
 * zone), from `llm_usage`.
 */
export async function spentTodayUsd(db: Database, userId: string, now: Date): Promise<number> {
  const settings = await db.revisionSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  const since = startOfLocalDay(now, settings?.timezone ?? DEFAULT_TIME_ZONE);
  const { _sum } = await db.llmUsage.aggregate({
    where: { userId, createdAt: { gte: since, lte: now } },
    _sum: { costUsd: true },
  });
  return Number(_sum.costUsd ?? 0);
}

/**
 * Refuses a call once today's spend has reached the budget. Checked before each call, so the call
 * that crosses the budget still runs; the next one is refused.
 */
export async function assertWithinBudget(
  db: Database,
  userId: string,
  budgetUsd: number,
  now: Date,
): Promise<void> {
  const spent = await spentTodayUsd(db, userId, now);
  if (spent >= budgetUsd) throw new BudgetExceededError(spent, budgetUsd);
}
