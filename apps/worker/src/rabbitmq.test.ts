import { describe, expect, it } from "vitest";
import { backoffDelay } from "./rabbitmq";

describe("backoffDelay", () => {
  it("doubles the delay on every attempt", () => {
    expect([1, 2, 3, 4].map((attempt) => backoffDelay(attempt, 500, 10_000))).toEqual([
      500, 1000, 2000, 4000,
    ]);
  });

  it("never waits longer than the cap", () => {
    expect(backoffDelay(20, 500, 10_000)).toBe(10_000);
  });
});
