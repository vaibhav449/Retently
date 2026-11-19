import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const base = {
  RABBITMQ_URL: "amqp://app:app@127.0.0.1:5672",
  DATABASE_URL: "postgres://app:app@127.0.0.1:5432/app",
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
};

describe("loadEnv", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
  ])("refuses to start when the Gemini key is %s, and names the key", (_case, key) => {
    const env = { ...base, GOOGLE_GENERATIVE_AI_API_KEY: key };
    expect(() => loadEnv(env)).toThrow(/GOOGLE_GENERATIVE_AI_API_KEY is required/);
  });

  it("defaults the daily budget to $0.50 and the health port to 4001", () => {
    expect(loadEnv(base)).toMatchObject({ LLM_DAILY_BUDGET_USD: 0.5, HEALTH_PORT: 4001 });
  });

  it("reads the daily budget, and refuses one that is not positive", () => {
    expect(loadEnv({ ...base, LLM_DAILY_BUDGET_USD: "1.25" }).LLM_DAILY_BUDGET_USD).toBe(1.25);
    expect(() => loadEnv({ ...base, LLM_DAILY_BUDGET_USD: "0" })).toThrow(/LLM_DAILY_BUDGET_USD/);
  });

  it("refuses a RabbitMQ URL that is not amqp", () => {
    expect(() => loadEnv({ ...base, RABBITMQ_URL: "http://127.0.0.1:5672" })).toThrow(
      /RABBITMQ_URL/,
    );
  });
});
