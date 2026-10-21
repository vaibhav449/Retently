/** One day in milliseconds: the only definition of "a day" in the scheduler (04-scheduler.md §2). */
export const DAY_MS = 86_400_000;

/** Days from `earlier` to `later`, as a fraction (8 hours is 1/3). Negative if `later` comes first. */
export function daysBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / DAY_MS;
}

/** A new date `days` days after `date`. The input is left unchanged. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
