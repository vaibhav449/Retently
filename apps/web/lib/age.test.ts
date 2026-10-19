import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ageOn, dobSchema } from "./age";

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("ageOn", () => {
  it("counts a birthday that has passed this year", () => {
    expect(ageOn(utc("2008-03-10"), utc("2026-10-19"))).toBe(18);
  });

  it("does not count a birthday later this year", () => {
    expect(ageOn(utc("2008-11-01"), utc("2026-10-19"))).toBe(17);
  });

  it("turns 18 exactly on the birthday", () => {
    expect(ageOn(utc("2008-10-19"), utc("2026-10-18"))).toBe(17);
    expect(ageOn(utc("2008-10-19"), utc("2026-10-19"))).toBe(18);
  });

  it("treats a 29 February birthday as reached on 1 March in a non-leap year", () => {
    expect(ageOn(utc("2008-02-29"), utc("2026-02-28"))).toBe(17);
    expect(ageOn(utc("2008-02-29"), utc("2026-03-01"))).toBe(18);
  });
});

describe("dobSchema", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("accepts someone who turns 18 today and returns UTC midnight", () => {
    expect(dobSchema.parse("2008-10-19")).toEqual(utc("2008-10-19"));
  });

  it("accepts an ISO timestamp, as sent by the auth client", () => {
    expect(dobSchema.parse("2000-01-15T00:00:00.000Z")).toEqual(utc("2000-01-15"));
  });

  it("rejects someone who turns 18 tomorrow", () => {
    const result = dobSchema.safeParse("2008-10-20");
    expect(result.error?.issues[0]?.message).toBe("You must be 18 or older to use Retently");
  });

  it("rejects a future date", () => {
    expect(dobSchema.safeParse("2030-01-01").success).toBe(false);
  });

  it("rejects an implausible age", () => {
    expect(dobSchema.safeParse("1890-01-01").success).toBe(false);
  });

  it("rejects text that is not a date", () => {
    expect(dobSchema.safeParse("not a date").success).toBe(false);
  });
});
