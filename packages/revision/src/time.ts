import { DEFAULT_TIME_ZONE } from "./config";

const HOUR_MS = 60 * 60 * 1000;
/** Every real calendar day is shorter than this, so the next local day starts within it. */
const SEARCH_SPAN_MS = 48 * HOUR_MS;

/** One formatter per zone: building one is the expensive part of reading a local date. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    // Throws a RangeError for a zone Intl does not know, before anything is cached.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The calendar date of `ms` in the formatter's zone, as one comparable number: yyyymmdd. */
function localDate(ms: number, formatter: Intl.DateTimeFormat): number {
  let year = 0;
  let month = 0;
  let day = 0;
  for (const part of formatter.formatToParts(ms)) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
  }
  return year * 10_000 + month * 100 + day;
}

/**
 * The first instant after `at` whose calendar date in `timeZone` is later than `at`'s
 * (05-review-pipeline.md §6.2). At exactly local midnight that is the next midnight, never `at`
 * itself; when DST skips midnight it is the first instant of the new date (e.g. 01:00).
 *
 * A binary search on local dates, with no offset arithmetic, so DST gaps cannot fool it.
 * `timeZone` must be valid: pass it through resolveTimeZone() first.
 */
export function startOfNextLocalDay(at: Date, timeZone: string): Date {
  const start = at.getTime();
  if (!Number.isFinite(start)) throw new RangeError("startOfNextLocalDay: invalid date");
  const formatter = formatterFor(timeZone);
  const today = localDate(start, formatter);

  // Invariant: localDate(lo) ≤ today < localDate(hi).
  let lo = start;
  let hi = start + SEARCH_SPAN_MS;
  if (localDate(hi, formatter) <= today) {
    throw new RangeError(`no new local day in ${timeZone} within 48 hours of ${at.toISOString()}`);
  }
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (localDate(mid, formatter) > today) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/**
 * `value` if Intl accepts it as a time zone, else DEFAULT_TIME_ZONE. The one resolver used by
 * recordReview(), rebuild and check, so a bad settings value never fails a review and never
 * makes the live path and the replay disagree (I4).
 */
export function resolveTimeZone(value: string | null | undefined): string {
  if (!value) return DEFAULT_TIME_ZONE;
  try {
    formatterFor(value);
    return value;
  } catch (error) {
    if (error instanceof RangeError) return DEFAULT_TIME_ZONE;
    throw error;
  }
}
