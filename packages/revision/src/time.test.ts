import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE } from "./config";
import { resolveTimeZone, startOfNextLocalDay } from "./time";

/**
 * 05-review-pipeline.md §6.2, IMPLEMENTATION_PLAN §4.7. Each expected value was checked against a
 * brute-force oracle (ICU 78.3, tz 2026c).
 */
const VECTORS: { zone: string; at: string; expected: string; why: string }[] = [
  {
    zone: "Asia/Kolkata",
    at: "2026-11-18T15:30:00.000Z",
    expected: "2026-11-18T18:30:00.000Z",
    why: "a 21:00 mistake is due from the next local midnight (R2.5)",
  },
  {
    zone: "Asia/Kolkata",
    at: "2026-11-18T18:29:59.999Z",
    expected: "2026-11-18T18:30:00.000Z",
    why: "1 ms before local midnight",
  },
  {
    zone: "Asia/Kolkata",
    at: "2026-11-18T18:30:00.000Z",
    expected: "2026-11-19T18:30:00.000Z",
    why: "exactly local midnight: the next one, never itself",
  },
  {
    zone: "Asia/Kolkata",
    at: "2026-11-18T20:00:00.000Z",
    expected: "2026-11-19T18:30:00.000Z",
    why: "01:30 IST while the UTC date is still the day before",
  },
  {
    zone: "Asia/Kolkata",
    at: "2026-11-18T23:59:59.999Z",
    expected: "2026-11-19T18:30:00.000Z",
    why: "just before UTC midnight",
  },
  {
    zone: "Asia/Kolkata",
    at: "2026-11-19T00:00:00.000Z",
    expected: "2026-11-19T18:30:00.000Z",
    why: "exactly UTC midnight changes nothing",
  },
  {
    zone: "Asia/Kolkata",
    at: "2026-12-31T18:00:00.000Z",
    expected: "2026-12-31T18:30:00.000Z",
    why: "year rollover",
  },
  {
    zone: "Asia/Kolkata",
    at: "2027-02-28T10:00:00.000Z",
    expected: "2027-02-28T18:30:00.000Z",
    why: "non-leap February",
  },
  {
    zone: "Asia/Kolkata",
    at: "2028-02-28T10:00:00.000Z",
    expected: "2028-02-28T18:30:00.000Z",
    why: "leap February",
  },
  {
    zone: "UTC",
    at: "2026-11-18T23:59:59.999Z",
    expected: "2026-11-19T00:00:00.000Z",
    why: "UTC zone, 1 ms before midnight",
  },
  {
    zone: "UTC",
    at: "2026-11-19T00:00:00.000Z",
    expected: "2026-11-20T00:00:00.000Z",
    why: "UTC zone, exactly midnight",
  },
  {
    zone: "Asia/Kathmandu",
    at: "2026-11-18T18:14:59.999Z",
    expected: "2026-11-18T18:15:00.000Z",
    why: "+05:45 offset",
  },
  {
    zone: "America/New_York",
    at: "2026-10-31T22:00:00.000Z",
    expected: "2026-11-01T04:00:00.000Z",
    why: "the day that ends DST",
  },
  {
    zone: "America/New_York",
    at: "2026-11-01T15:00:00.000Z",
    expected: "2026-11-02T05:00:00.000Z",
    why: "a 25-hour day",
  },
  {
    zone: "America/Santiago",
    at: "2026-09-06T01:00:00.000Z",
    expected: "2026-09-06T04:00:00.000Z",
    why: "midnight skipped by DST: 01:00 local",
  },
  {
    zone: "America/Santiago",
    at: "2026-04-04T23:00:00.000Z",
    expected: "2026-04-05T04:00:00.000Z",
    why: "falls back at 24:00",
  },
  {
    zone: "America/Havana",
    at: "2026-03-08T02:00:00.000Z",
    expected: "2026-03-08T05:00:00.000Z",
    why: "midnight skipped by DST: 01:00 local",
  },
  {
    zone: "Asia/Beirut",
    at: "2026-03-28T19:00:00.000Z",
    expected: "2026-03-28T22:00:00.000Z",
    why: "midnight skipped by DST, east of UTC",
  },
];

const oracleFormatters = new Map<string, Intl.DateTimeFormat>();

/** An independent oracle: the local calendar date as "yyyy-mm-dd", which sorts like the date. */
function localDateOf(ms: number, timeZone: string): string {
  let formatter = oracleFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    oracleFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(ms);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${field("year")}-${field("month")}-${field("day")}`;
}

/** Seeded and deterministic (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SWEEP_ZONES = [
  "Asia/Kolkata",
  "UTC",
  "Asia/Kathmandu",
  "America/New_York",
  "America/Santiago",
  "America/Havana",
  "Asia/Beirut",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
];
const SWEEP_SEED = 20261118;
const SWEEP_INSTANTS_PER_ZONE = 200;
const FROM = Date.UTC(2026, 0, 1);
const TO = Date.UTC(2031, 0, 1);
const HOURS_48 = 48 * 60 * 60 * 1000;

/** Every property the definition promises, or a description of the first one that fails. */
function violation(at: number, timeZone: string): string | null {
  const result = startOfNextLocalDay(new Date(at), timeZone).getTime();
  const today = localDateOf(at, timeZone);
  if (!(result > at)) return "result is not after `at`";
  if (!(localDateOf(result, timeZone) > today)) return "result is not on a later local date";
  if (localDateOf(result - 1, timeZone) !== today)
    return "1 ms before the result is not `at`'s date";
  if (result - at > HOURS_48) return "result is more than 48 h after `at`";
  return null;
}

describe("startOfNextLocalDay", () => {
  it.each(VECTORS)("$zone $at → $expected ($why)", ({ zone, at, expected }) => {
    expect(startOfNextLocalDay(new Date(at), zone).toISOString()).toBe(expected);
  });

  it(`holds its definition for random instants in 2026–2030 across zones (seed ${SWEEP_SEED})`, () => {
    const next = random(SWEEP_SEED);
    const failures: string[] = [];
    for (const zone of SWEEP_ZONES) {
      for (let i = 0; i < SWEEP_INSTANTS_PER_ZONE; i++) {
        const at = FROM + Math.floor(next() * (TO - FROM));
        // Also probe exactly at, and 1 ms before, the boundary the random instant leads to.
        const boundary = startOfNextLocalDay(new Date(at), zone).getTime();
        for (const probe of [at, boundary, boundary - 1]) {
          const problem = violation(probe, zone);
          if (problem) failures.push(`${zone} ${new Date(probe).toISOString()}: ${problem}`);
        }
      }
    }
    expect(failures, `seed ${SWEEP_SEED}`).toEqual([]);
  }, 30_000);

  it("refuses an invalid date", () => {
    expect(() => startOfNextLocalDay(new Date(Number.NaN), "UTC")).toThrow(RangeError);
  });
});

describe("resolveTimeZone", () => {
  it.each([null, undefined, "", "Not/AZone"])("falls back to the default for %j", (value) => {
    expect(resolveTimeZone(value)).toBe(DEFAULT_TIME_ZONE);
    expect(DEFAULT_TIME_ZONE).toBe("Asia/Kolkata");
  });

  it.each(["UTC", "America/New_York", "Asia/Kathmandu"])("keeps a valid zone: %s", (zone) => {
    expect(resolveTimeZone(zone)).toBe(zone);
  });
});
