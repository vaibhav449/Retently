import type { Database } from "@repo/db";
import type { QueueConfig } from "./config";
import { clamp } from "./queue/features";
import { resolveTimeZone } from "./time";

/**
 * The user's time zone for "the next local day" (05-review-pipeline.md §6.2): their
 * revision_settings.timezone, or DEFAULT_TIME_ZONE when there is no row or the zone is unknown
 * (R3.2, DD-3). One primary-key read; never creates a row.
 */
export async function userTimeZone(
  db: Pick<Database, "revisionSettings">,
  userId: string,
): Promise<string> {
  const row = await db.revisionSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return resolveTimeZone(row?.timezone);
}

/**
 * The user's zone and daily budget (06-queue-ranker.md §5, Q3.1): from revision_settings, else
 * the defaults; the budget is clamped to cfg.budgetBoundsSec (the column's CHECK). One
 * primary-key read; never creates a row.
 */
export async function userRevisionSettings(
  db: Pick<Database, "revisionSettings">,
  userId: string,
  cfg: QueueConfig,
): Promise<{ timeZone: string; budgetSec: number }> {
  const row = await db.revisionSettings.findUnique({
    where: { userId },
    select: { timezone: true, dailyBudgetSec: true },
  });
  const [low, high] = cfg.budgetBoundsSec;
  return {
    timeZone: resolveTimeZone(row?.timezone),
    budgetSec: clamp(row?.dailyBudgetSec ?? cfg.defaultBudgetSec, low, high),
  };
}
