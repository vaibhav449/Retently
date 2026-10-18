import { describe, expect, it } from "vitest";
import { wsEnvelopeSchema } from "./ws";

describe("wsEnvelopeSchema", () => {
  it("accepts a message with type, payload and request_id", () => {
    const message = { type: "ping", payload: { n: 1 }, request_id: "r1" };
    expect(wsEnvelopeSchema.parse(message)).toEqual(message);
  });

  it("accepts a message without request_id", () => {
    expect(wsEnvelopeSchema.safeParse({ type: "ping", payload: null }).success).toBe(true);
  });

  it("rejects a message without a type", () => {
    expect(wsEnvelopeSchema.safeParse({ payload: {} }).success).toBe(false);
  });

  it("rejects an empty request_id", () => {
    expect(wsEnvelopeSchema.safeParse({ type: "ping", request_id: "" }).success).toBe(false);
  });
});
