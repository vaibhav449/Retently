import {
  cachedLatencyMedians,
  type Clock,
  createDefaultRegistry,
  DEFAULT_GRADING,
  DEFAULT_QUEUE,
  LATENCY_MEDIAN_CACHE_MAX_ENTRIES,
  LATENCY_MEDIAN_CACHE_TTL_MS,
  type LatencyMedianSource,
  latencyMediansFromDb,
  type SessionDeps,
  systemClock,
} from "@repo/revision";
import { getDb } from "./db";

// One cache per process. Route deps are built per request, so the cache can't live on them; in
// development, hot reload re-runs this module, so it is kept on globalThis like getDb().
const globalForMedians = globalThis as { retentlyLatencyMedians?: LatencyMedianSource };

/**
 * The latency medians POST /api/review/answer grades with: from review_log, each reused for up to
 * five minutes per (user, item type) in this process (05-review-pipeline.md §4, DD-8).
 */
export function latencyMedians(): LatencyMedianSource {
  globalForMedians.retentlyLatencyMedians ??= cachedLatencyMedians(
    latencyMediansFromDb(getDb(), DEFAULT_GRADING.latency),
    { ttlMs: LATENCY_MEDIAN_CACHE_TTL_MS, maxEntries: LATENCY_MEDIAN_CACHE_MAX_ENTRIES },
  );
  return globalForMedians.retentlyLatencyMedians;
}

/** Request header (dev and E2E only): shift the review clock by this many milliseconds. */
export const REVIEW_CLOCK_OFFSET_HEADER = "x-review-clock-offset-ms";
/** Response header set when the offset was honoured, so a test can tell it was. */
export const REVIEW_CLOCK_HEADER = "x-review-clock";

const INTEGER = /^-?\d+$/;

/**
 * The clock for one review request (DD-14): the system clock, unless the test clock is enabled
 * (REVIEW_TEST_CLOCK=1, never with NODE_ENV=production) and the request carries an integer
 * offset header, in which case "now" is shifted by that offset. Lets Playwright move the server
 * past midnight without touching stored timestamps. Not part of the API contract.
 */
export function reviewClock(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): { clock: Clock; shifted: boolean } {
  const system = { clock: systemClock, shifted: false };
  if (env.NODE_ENV === "production" || env.REVIEW_TEST_CLOCK !== "1") return system;

  const header = request.headers.get(REVIEW_CLOCK_OFFSET_HEADER)?.trim();
  if (header === undefined || !INTEGER.test(header)) return system;
  const offsetMs = Number(header);
  if (!Number.isSafeInteger(offsetMs)) return system;
  return { clock: { now: () => new Date(Date.now() + offsetMs) }, shifted: true };
}

/** The headers every review response carries; marks a shifted clock. */
export function reviewHeaders(shifted: boolean): Record<string, string> {
  return { "cache-control": "no-store", ...(shifted && { [REVIEW_CLOCK_HEADER]: "offset" }) };
}

/**
 * What the daily-session routes give the engine (06-queue-ranker.md §8): the request's review clock,
 * so the E2E test clock moves the local day too, and the process's cached latency medians (QD-8).
 */
export function sessionDeps(request: Request): { deps: SessionDeps; shifted: boolean } {
  const { clock, shifted } = reviewClock(request);
  return {
    deps: {
      db: getDb(),
      clock,
      registry: createDefaultRegistry(),
      grading: DEFAULT_GRADING,
      queue: DEFAULT_QUEUE,
      medians: latencyMedians(),
    },
    shifted,
  };
}
