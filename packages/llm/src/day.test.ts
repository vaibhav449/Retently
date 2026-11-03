import { describe, expect, it } from "vitest";
import { startOfLocalDay } from "./day";

describe("startOfLocalDay", () => {
  it("starts an Indian day at 18:30 UTC the day before", () => {
    expect(startOfLocalDay(new Date("2026-11-03T10:00:00Z"), "Asia/Kolkata")).toEqual(
      new Date("2026-11-02T18:30:00Z"),
    );
  });

  it("counts a UTC evening as the next Indian day", () => {
    // 20:00 UTC on 2 Nov is 01:30 on 3 Nov in India.
    expect(startOfLocalDay(new Date("2026-11-02T20:00:00Z"), "Asia/Kolkata")).toEqual(
      new Date("2026-11-02T18:30:00Z"),
    );
  });

  it("is its own start at exactly midnight", () => {
    const midnight = new Date("2026-11-02T18:30:00Z");
    expect(startOfLocalDay(midnight, "Asia/Kolkata")).toEqual(midnight);
  });

  it("handles a day that starts on a DST change", () => {
    // New York leaves DST at 02:00 on 1 Nov 2026; that day began at 00:00 EDT (04:00 UTC).
    expect(startOfLocalDay(new Date("2026-11-01T15:00:00Z"), "America/New_York")).toEqual(
      new Date("2026-11-01T04:00:00Z"),
    );
    // The next day starts at 00:00 EST (05:00 UTC).
    expect(startOfLocalDay(new Date("2026-11-02T15:00:00Z"), "America/New_York")).toEqual(
      new Date("2026-11-02T05:00:00Z"),
    );
  });

  it("uses UTC as is", () => {
    expect(startOfLocalDay(new Date("2026-11-03T23:59:59.999Z"), "UTC")).toEqual(
      new Date("2026-11-03T00:00:00Z"),
    );
  });
});
