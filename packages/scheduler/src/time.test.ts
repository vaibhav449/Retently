import { describe, expect, it } from "vitest";
import { addDays, DAY_MS, daysBetween } from "./time";

describe("daysBetween", () => {
  it("counts exactly 24 hours as one day", () => {
    expect(daysBetween(new Date("2026-10-02T09:00:00Z"), new Date("2026-10-01T09:00:00Z"))).toBe(1);
  });

  it("measures elapsed time, not calendar days: 22:00 to 06:00 IST is a third of a day", () => {
    const evening = new Date("2026-10-19T22:00:00+05:30");
    const nextMorning = new Date("2026-10-20T06:00:00+05:30");
    expect(daysBetween(nextMorning, evening)).toBeCloseTo(1 / 3, 10);
  });

  it("is negative when the dates come in the other order", () => {
    expect(daysBetween(new Date("2026-10-01T09:00:00Z"), new Date("2026-10-02T09:00:00Z"))).toBe(
      -1,
    );
  });
});

describe("addDays", () => {
  it("returns a new date exactly n days later and leaves the input alone", () => {
    const start = new Date("2026-10-01T09:00:00.000Z");
    const later = addDays(start, 1);
    expect(later.toISOString()).toBe("2026-10-02T09:00:00.000Z");
    expect(later.getTime() - start.getTime()).toBe(DAY_MS);
    expect(start.toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });
});
