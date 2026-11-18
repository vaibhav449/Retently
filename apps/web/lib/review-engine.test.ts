import { describe, expect, it } from "vitest";
import {
  REVIEW_CLOCK_HEADER,
  REVIEW_CLOCK_OFFSET_HEADER,
  reviewClock,
  reviewHeaders,
} from "./review-engine";

const HOUR = 60 * 60 * 1000;
const enabled = { NODE_ENV: "development", REVIEW_TEST_CLOCK: "1" };
const withOffset = (value: string) =>
  new Request("http://localhost/api/review/next", {
    headers: { [REVIEW_CLOCK_OFFSET_HEADER]: value },
  });

describe("reviewClock (DD-14)", () => {
  it("shifts the clock by the header's offset when the test clock is enabled", () => {
    const before = Date.now();
    const { clock, shifted } = reviewClock(withOffset(String(5 * HOUR)), enabled);
    const now = clock.now().getTime();
    expect(shifted).toBe(true);
    expect(now).toBeGreaterThanOrEqual(before + 5 * HOUR);
    expect(now).toBeLessThan(Date.now() + 5 * HOUR + 1_000);
  });

  it("accepts a negative offset", () => {
    const { clock, shifted } = reviewClock(withOffset("-60000"), enabled);
    expect(shifted).toBe(true);
    expect(clock.now().getTime()).toBeLessThan(Date.now() - 59_000);
  });

  it("is ignored in production, even with the flag set", () => {
    const env = { NODE_ENV: "production", REVIEW_TEST_CLOCK: "1" };
    expect(reviewClock(withOffset("3600000"), env).shifted).toBe(false);
  });

  it("is ignored without the flag", () => {
    expect(reviewClock(withOffset("3600000"), { NODE_ENV: "development" }).shifted).toBe(false);
    expect(
      reviewClock(withOffset("3600000"), { NODE_ENV: "development", REVIEW_TEST_CLOCK: "true" })
        .shifted,
    ).toBe(false);
  });

  it.each(["", "abc", "1.5", "1e6", "99999999999999999999"])(
    "ignores a malformed offset: %j",
    (value) => {
      expect(reviewClock(withOffset(value), enabled).shifted).toBe(false);
    },
  );

  it("uses the system clock without the header", () => {
    const request = new Request("http://localhost/api/review/next");
    const { clock, shifted } = reviewClock(request, enabled);
    expect(shifted).toBe(false);
    expect(Math.abs(clock.now().getTime() - Date.now())).toBeLessThan(1_000);
  });
});

describe("reviewHeaders", () => {
  it("marks a shifted clock and never caches", () => {
    expect(reviewHeaders(true)).toEqual({
      "cache-control": "no-store",
      [REVIEW_CLOCK_HEADER]: "offset",
    });
    expect(reviewHeaders(false)).toEqual({ "cache-control": "no-store" });
  });
});
