import { describe, expect, it } from "vitest";
import { z } from "zod";
import { uuidv7 } from "./uuidv7";

const AT = new Date("2026-10-21T09:00:00.123Z");

describe("uuidv7", () => {
  it("is a valid version 7 UUID", () => {
    const id = uuidv7(AT);
    expect(z.uuid({ version: "v7" }).safeParse(id).success).toBe(true);
    expect(id[14]).toBe("7");
  });

  it("starts with the timestamp in milliseconds", () => {
    const id = uuidv7(AT);
    expect(parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(AT.getTime());
  });

  it("sorts in the order the ids were minted, even when random bits would say otherwise", () => {
    const high = new Uint8Array(10).fill(0xff);
    const low = new Uint8Array(10);
    const earlier = uuidv7(AT, high);
    const later = uuidv7(new Date(AT.getTime() + 1), low);
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it("is deterministic when the random bytes are given", () => {
    const random = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(uuidv7(AT, random)).toBe(uuidv7(AT, random));
  });
});
