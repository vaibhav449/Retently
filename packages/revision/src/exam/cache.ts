import { createHash } from "node:crypto";
import type { ForecastInput } from "./forecast";

export interface ForecastCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
}

/**
 * A process-wide TTL cache (07 §5.2, EM-13): an entry lives `ttlMs`, and past `maxEntries` the
 * oldest goes first. The clock is injected. Not shared between processes.
 */
export function createForecastCache<T>(opts: {
  ttlMs: number;
  maxEntries: number;
  now: () => number;
}): ForecastCache<T> {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= opts.now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: opts.now() + opts.ttlMs });
      while (entries.size > opts.maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
  };
}

/**
 * The cache key of a forecast (ER4.5, EM-13): SHA-256 over the exam (its id, date, scope, target
 * and updated_at, so an edit always misses), the local date, and everything the simulation reads:
 * each item's state and effective due date, the slots, the average cost and the recent grades.
 * `now` is left out: within the TTL a stored result is returned with its own computed_at. Pure.
 */
export function forecastKey(input: ForecastInput): string {
  const hash = createHash("sha256");
  const { exam } = input;
  hash.update(
    JSON.stringify([
      exam.id,
      exam.examDate,
      exam.topicKeys,
      exam.target,
      exam.updatedAt.toISOString(),
      input.today,
      input.timeZone,
      input.slotsPerDay,
      input.avgCostSec,
      input.recentGrades,
      input.registry.active.version,
    ]),
  );
  for (const item of input.items) {
    hash.update(
      JSON.stringify([
        item.itemId,
        item.schedulerVersion,
        item.state,
        item.dueAt?.getTime() ?? null,
      ]),
    );
  }
  return hash.digest("hex");
}
