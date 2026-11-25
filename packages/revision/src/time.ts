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
 * The calendar date of `at` in `timeZone`, as "YYYY-MM-DD": review_sessions.local_date
 * (06-queue-ranker.md §8). `timeZone` must be valid: pass it through resolveTimeZone() first.
 */
export function localDateOf(at: Date, timeZone: string): string {
  const ms = at.getTime();
  if (!Number.isFinite(ms)) throw new RangeError("localDateOf: invalid date");
  const yyyymmdd = localDate(ms, formatterFor(timeZone));
  const year = String(Math.floor(yyyymmdd / 10_000)).padStart(4, "0");
  const month = String(Math.floor(yyyymmdd / 100) % 100).padStart(2, "0");
  const day = String(yyyymmdd % 100).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date "YYYY-MM-DD" as its UTC-midnight instant; throws for anything else. */
function utcMidnight(date: string): number {
  const match = DATE_PATTERN.exec(date);
  const ms = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`not a calendar date: ${date}`);
  }
  return ms;
}

/** The calendar date `days` days after `date` (both "YYYY-MM-DD"); no zone involved. */
export function addLocalDays(date: string, days: number): string {
  return new Date(utcMidnight(date) + days * 24 * HOUR_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` ("YYYY-MM-DD"), negative when `to` comes first. */
export function localDaysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / (24 * HOUR_MS));
}

/**
 * The first instant of the calendar date `date` ("YYYY-MM-DD") in `timeZone`: an exam's exam_at
 * (07-exam-mode.md §2). When DST skips midnight it is the first instant that exists (e.g. 01:00).
 * A binary search on local dates, like startOfNextLocalDay(). `timeZone` must be valid.
 */
export function startOfLocalDate(date: string, timeZone: string): Date {
  const formatter = formatterFor(timeZone);
  const noon = utcMidnight(date) + 12 * HOUR_MS;
  const target = Number(date.replaceAll("-", ""));
  // Every zone is within ±14 h of UTC, so the date has begun by noon UTC + 48 h and not by −48 h.
  // Invariant: localDate(lo) < target ≤ localDate(hi).
  let lo = noon - SEARCH_SPAN_MS;
  let hi = noon + SEARCH_SPAN_MS;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (localDate(mid, formatter) >= target) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/** The first instant of `at`'s calendar date in `timeZone`. `timeZone` must be valid. */
export function startOfLocalDay(at: Date, timeZone: string): Date {
  return startOfLocalDate(localDateOf(at, timeZone), timeZone);
}

/**
 * The boundaries of `days` local days from `today` on: `days + 1` instants, the start of `today`
 * first and the start of the day after the last one last, each from startOfNextLocalDay(), so a
 * DST change makes a day 23 or 25 hours long instead of shifting the next. The forecast's study
 * days (07 §5.1). `timeZone` must be valid.
 */
export function localDayStarts(today: string, days: number, timeZone: string): Date[] {
  if (!Number.isInteger(days) || days < 0) throw new RangeError(`localDayStarts: ${days} days`);
  const starts = [startOfLocalDate(today, timeZone)];
  for (let day = 1; day <= days; day += 1) {
    starts.push(startOfNextLocalDay(starts[day - 1] as Date, timeZone));
  }
  return starts;
}
