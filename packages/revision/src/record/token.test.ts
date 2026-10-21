import { signRealtimeToken } from "@repo/realtime-token";
import { describe, expect, it } from "vitest";
import {
  type Presentation,
  PRESENTATION_TOKEN_TTL_MS,
  signPresentationToken,
  verifyPresentationToken,
} from "./token";
import { uuidv7 } from "./uuidv7";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const PRESENTED_AT = new Date("2026-10-21T09:00:00.250Z");
const later = (ms: number) => new Date(PRESENTED_AT.getTime() + ms);

const presentation: Presentation = {
  reviewId: uuidv7(PRESENTED_AT),
  userId: "user_42",
  itemId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  sessionId: null,
  presentedAt: PRESENTED_AT,
};

describe("presentation token", () => {
  it("round-trips the presentation, to the millisecond", async () => {
    const token = await signPresentationToken(presentation, SECRET);
    expect(await verifyPresentationToken(token, SECRET, later(4_200))).toEqual({
      ok: true,
      presentation,
    });
  });

  it("is still valid just before six hours, and expired just after", async () => {
    const token = await signPresentationToken(presentation, SECRET);
    const before = await verifyPresentationToken(
      token,
      SECRET,
      later(PRESENTATION_TOKEN_TTL_MS - 1000),
    );
    const after = await verifyPresentationToken(
      token,
      SECRET,
      later(PRESENTATION_TOKEN_TTL_MS + 1000),
    );
    expect(before.ok).toBe(true);
    expect(after).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signPresentationToken(
      presentation,
      "another-secret-that-is-at-least-32-chars",
    );
    expect(await verifyPresentationToken(token, SECRET, later(1000))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects a token whose item was edited", async () => {
    const token = await signPresentationToken(presentation, SECRET);
    const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString()) as object;
    const edited = Buffer.from(
      JSON.stringify({ ...claims, iid: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e" }),
    ).toString("base64url");
    expect(
      await verifyPresentationToken(`${header}.${edited}.${signature}`, SECRET, later(1000)),
    ).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects a realtime token, even one signed with the same secret", async () => {
    const realtime = await signRealtimeToken({ userId: "user_42" }, SECRET, PRESENTED_AT);
    expect(await verifyPresentationToken(realtime, SECRET, later(1000))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
