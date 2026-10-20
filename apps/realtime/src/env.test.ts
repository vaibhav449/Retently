import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const SECRET = "test-secret-that-is-at-least-32-characters-long";

describe("loadEnv", () => {
  it("refuses to start without REALTIME_TOKEN_SECRET", () => {
    expect(() => loadEnv({})).toThrow(/REALTIME_TOKEN_SECRET/);
  });

  it("refuses a secret shorter than 32 characters", () => {
    expect(() => loadEnv({ REALTIME_TOKEN_SECRET: "too-short" })).toThrow(/REALTIME_TOKEN_SECRET/);
  });

  it("reads the secret and keeps the defaults", () => {
    expect(loadEnv({ REALTIME_TOKEN_SECRET: SECRET })).toEqual({
      HOST: "0.0.0.0",
      PORT: 4000,
      REALTIME_TOKEN_SECRET: SECRET,
    });
  });
});
