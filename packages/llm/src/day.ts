/** The time zone for users without revision settings, matching `revision_settings.timezone`. */
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

/** The wall-clock fields of `at` in `timeZone`. */
function wallClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    hour: field("hour"),
    minute: field("minute"),
    second: field("second"),
  };
}

/** How far `timeZone`'s wall clock is ahead of UTC at `at`, in milliseconds. */
function offsetMs(at: number, timeZone: string): number {
  const c = wallClock(new Date(at), timeZone);
  const wholeSeconds = at - (((at % 1000) + 1000) % 1000);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - wholeSeconds;
}

/** The instant the local day containing `now` began in `timeZone`. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  const { year, month, day } = wallClock(now, timeZone);
  const midnight = Date.UTC(year, month - 1, day);
  // Local midnight is UTC midnight minus the zone's offset; the second pass corrects for a DST
  // change between the two instants.
  const guess = midnight - offsetMs(midnight, timeZone);
  return new Date(midnight - offsetMs(guess, timeZone));
}
