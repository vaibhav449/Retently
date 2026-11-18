import type { Database } from "@repo/db";
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
