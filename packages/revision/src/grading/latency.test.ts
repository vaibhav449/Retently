import { describe, expect, it } from "vitest";
import {
  cachedLatencyMedians,
  type LatencyMedianSource,
  type MedianQuery,
  median,
} from "./latency";

describe("median", () => {
  it("is the middle value of an odd count", () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it("is the mean of the two middle values of an even count (percentile_cont(0.5))", () => {
    expect(median([40, 10, 30, 20])).toBe(25);
  });

  it("counts a latency of 0", () => {
    expect(median([0, 0, 5])).toBe(0);
  });

  it("does not modify its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it("refuses an empty list", () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

/** A source that answers from a table and counts its calls. */
function fakeSource(answers: Record<string, number | null>) {
  const calls: string[] = [];
  const source: LatencyMedianSource = {
    medianMs(query) {
      const key = `${query.userId}:${query.itemType}`;
      calls.push(key);
      return Promise.resolve(answers[key] ?? null);
    },
  };
  return { source, calls };
}

const T0 = new Date("2026-11-18T10:00:00.000Z");
const TTL = 5 * 60_000;
const query = (now: Date, change: Partial<MedianQuery> = {}): MedianQuery => ({
  userId: "u1",
  itemType: "mcq",
  excludeReviewId: "r1",
  now,
  ...change,
});
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("cachedLatencyMedians (R1.6, DD-8)", () => {
  it("serves a hit within the TTL and asks the source again after it", async () => {
    const { source, calls } = fakeSource({ "u1:mcq": 8_000 });
    const cached = cachedLatencyMedians(source, { ttlMs: TTL, maxEntries: 10 });

    expect(await cached.medianMs(query(T0))).toBe(8_000);
    expect(await cached.medianMs(query(at(TTL - 1)))).toBe(8_000);
    expect(calls).toHaveLength(1);
    expect(await cached.medianMs(query(at(TTL)))).toBe(8_000);
    expect(calls).toHaveLength(2);
  });

  it("treats a clock that moved backwards as stale", async () => {
    const { source, calls } = fakeSource({ "u1:mcq": 8_000 });
    const cached = cachedLatencyMedians(source, { ttlMs: TTL, maxEntries: 10 });
    await cached.medianMs(query(T0));
    await cached.medianMs(query(at(-1)));
    expect(calls).toHaveLength(2);
  });

  it("never caches a missing median", async () => {
    const { source, calls } = fakeSource({});
    const cached = cachedLatencyMedians(source, { ttlMs: TTL, maxEntries: 10 });
    expect(await cached.medianMs(query(T0))).toBeNull();
    expect(await cached.medianMs(query(at(1)))).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("keeps users and item types apart", async () => {
    const { source, calls } = fakeSource({ "u1:mcq": 1, "u2:mcq": 2, "u1:cloze": 3 });
    const cached = cachedLatencyMedians(source, { ttlMs: TTL, maxEntries: 10 });
    expect(await cached.medianMs(query(T0))).toBe(1);
    expect(await cached.medianMs(query(T0, { userId: "u2" }))).toBe(2);
    expect(await cached.medianMs(query(T0, { itemType: "cloze" }))).toBe(3);
    expect(calls).toEqual(["u1:mcq", "u2:mcq", "u1:cloze"]);
  });

  it("evicts the oldest entry when full", async () => {
    const { source, calls } = fakeSource({ "u1:mcq": 1, "u2:mcq": 2, "u3:mcq": 3 });
    const cached = cachedLatencyMedians(source, { ttlMs: TTL, maxEntries: 2 });
    await cached.medianMs(query(T0, { userId: "u1" }));
    await cached.medianMs(query(at(1), { userId: "u2" }));
    await cached.medianMs(query(at(2), { userId: "u3" })); // evicts u1
    await cached.medianMs(query(at(3), { userId: "u2" })); // still cached
    await cached.medianMs(query(at(4), { userId: "u1" })); // a miss again
    expect(calls).toEqual(["u1:mcq", "u2:mcq", "u3:mcq", "u1:mcq"]);
  });
});
