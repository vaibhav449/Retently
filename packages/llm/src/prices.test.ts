import { describe, expect, it } from "vitest";
import { costUsd, priceOf, UnknownModelPriceError } from "./prices";

const NOV_2026 = new Date("2026-11-03T10:00:00Z");

describe("costUsd", () => {
  it("prices input and output tokens per million", () => {
    // 1,000 × $0.75/M + 500 × $3.75/M = $0.00075 + $0.001875
    expect(costUsd("gemini-3.6-flash", { inputTokens: 1_000, outputTokens: 500 }, NOV_2026)).toBe(
      0.002625,
    );
  });

  it("uses the price in force on the day of the call", () => {
    const tokens = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(costUsd("gemini-3.6-flash", tokens, new Date("2026-12-31T23:59:59Z"))).toBe(4.5);
    expect(costUsd("gemini-3.6-flash", tokens, new Date("2027-01-01T00:00:00Z"))).toBe(9);
  });

  it("rounds to the micro-dollar, like llm_usage.cost_usd", () => {
    expect(costUsd("gemini-3.5-flash-lite", { inputTokens: 1, outputTokens: 1 }, NOV_2026)).toBe(
      0.000003,
    );
  });

  it("costs nothing for no tokens", () => {
    expect(costUsd("gemini-3.5-flash", { inputTokens: 0, outputTokens: 0 }, NOV_2026)).toBe(0);
  });
});

describe("priceOf", () => {
  it("refuses a model with no price", () => {
    expect(() => priceOf("gpt-unknown", NOV_2026)).toThrow(UnknownModelPriceError);
  });

  it("refuses a date before the first price", () => {
    expect(() => priceOf("gemini-3.6-flash", new Date("2025-06-01T00:00:00Z"))).toThrow(
      UnknownModelPriceError,
    );
  });
});
