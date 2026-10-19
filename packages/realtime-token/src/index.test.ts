import { describe, expect, it } from "vitest";
import { REALTIME_TOKEN_TTL_SECONDS, signRealtimeToken, verifyRealtimeToken } from "./index";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const OTHER_SECRET = "another-secret-that-is-at-least-32-characters";
const NOW = new Date("2026-10-19T10:00:00Z");
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe("realtime token", () => {
  it("round-trips the user id", async () => {
    const token = await signRealtimeToken({ userId: "user_1" }, SECRET, NOW);
    expect(await verifyRealtimeToken(token, SECRET, later(10))).toEqual({
      ok: true,
      claims: { userId: "user_1" },
    });
  });

  it("is still valid just before it expires", async () => {
    const token = await signRealtimeToken({ userId: "user_1" }, SECRET, NOW);
    const result = await verifyRealtimeToken(token, SECRET, later(REALTIME_TOKEN_TTL_SECONDS - 1));
    expect(result.ok).toBe(true);
  });

  it("is rejected as expired after its lifetime", async () => {
    const token = await signRealtimeToken({ userId: "user_1" }, SECRET, NOW);
    const result = await verifyRealtimeToken(token, SECRET, later(REALTIME_TOKEN_TTL_SECONDS + 1));
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signRealtimeToken({ userId: "user_1" }, OTHER_SECRET, NOW);
    expect(await verifyRealtimeToken(token, SECRET, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a token whose payload was edited", async () => {
    const token = await signRealtimeToken({ userId: "user_1" }, SECRET, NOW);
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url");
    const forged = `${header}.${forgedPayload}.${signature}`;
    expect(await verifyRealtimeToken(forged, SECRET, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "none" })}.${encode({
      sub: "admin",
      iss: "retently-web",
      aud: "retently-realtime",
      exp: Math.floor(NOW.getTime() / 1000) + 60,
    })}.`;
    expect(await verifyRealtimeToken(unsigned, SECRET, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects garbage", async () => {
    expect(await verifyRealtimeToken("not-a-token", SECRET, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses a short secret", async () => {
    await expect(signRealtimeToken({ userId: "user_1" }, "too-short", NOW)).rejects.toThrow(
      /at least 32 characters/,
    );
  });
});
