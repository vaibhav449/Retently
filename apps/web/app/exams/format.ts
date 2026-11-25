/**
 * Date wording for the exam screens. Exam dates are calendar dates ("YYYY-MM-DD"), so they are
 * formatted at UTC midnight with timeZone UTC: no zone can shift them by a day.
 */
const longDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const shortDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const DAY_MS = 86_400_000;
const atUtcMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** "Thu, 3 December 2026". */
export function examDateLabel(date: string): string {
  return longDate.format(atUtcMidnight(date));
}

/** "Thu 19 Nov" for each of `count` days from `first` on. */
export function dayLabels(first: string, count: number): string[] {
  const start = atUtcMidnight(first).getTime();
  return Array.from({ length: count }, (_, i) =>
    shortDay.format(new Date(start + i * DAY_MS)).replace(",", ""),
  );
}

/** The calendar date `days` days after `date`. */
export function addDays(date: string, days: number): string {
  return new Date(atUtcMidnight(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** "today", "tomorrow", "in 14 days", "yesterday", "3 days ago". */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  if (daysLeft === -1) return "yesterday";
  return daysLeft > 0 ? `in ${daysLeft} days` : `${-daysLeft} days ago`;
}
