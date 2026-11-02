import { describe, expect, it } from "vitest";
import { attemptOf } from "./retry";

const withHeaders = (headers: Record<string, unknown> | undefined) =>
  ({ properties: { headers } }) as Parameters<typeof attemptOf>[0];

describe("attemptOf", () => {
  it("is 1 for a job that has never failed", () => {
    expect(attemptOf(withHeaders(undefined))).toBe(1);
    expect(attemptOf(withHeaders({}))).toBe(1);
  });

  it("reads our x-attempt header", () => {
    expect(attemptOf(withHeaders({ "x-attempt": 3 }))).toBe(3);
  });

  it("falls back to 1 when the header is not a positive whole number", () => {
    expect(attemptOf(withHeaders({ "x-attempt": "soon" }))).toBe(1);
    expect(attemptOf(withHeaders({ "x-attempt": 0 }))).toBe(1);
    expect(attemptOf(withHeaders({ "x-attempt": 2.5 }))).toBe(1);
  });
});
