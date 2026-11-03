import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const RABBITMQ_URL = "amqp://app:app@localhost:5672";

describe("loadEnv", () => {
  it("refuses to start without REALTIME_TOKEN_SECRET", () => {
    expect(() => loadEnv({ RABBITMQ_URL })).toThrow(/REALTIME_TOKEN_SECRET/);
  });

  it("refuses a secret shorter than 32 characters", () => {
    expect(() => loadEnv({ REALTIME_TOKEN_SECRET: "too-short", RABBITMQ_URL })).toThrow(
      /REALTIME_TOKEN_SECRET/,
    );
  });

  it("refuses to start without an AMQP RABBITMQ_URL", () => {
    expect(() => loadEnv({ REALTIME_TOKEN_SECRET: SECRET })).toThrow(/RABBITMQ_URL/);
    expect(() =>
      loadEnv({ REALTIME_TOKEN_SECRET: SECRET, RABBITMQ_URL: "http://localhost:5672" }),
    ).toThrow(/RABBITMQ_URL/);
  });

  it("reads the secret and the broker URL, and keeps the defaults", () => {
    expect(loadEnv({ REALTIME_TOKEN_SECRET: SECRET, RABBITMQ_URL })).toEqual({
      HOST: "0.0.0.0",
      PORT: 4000,
      REALTIME_TOKEN_SECRET: SECRET,
      RABBITMQ_URL,
    });
  });
});
