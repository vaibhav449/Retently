import { describe, expect, it } from "vitest";
import { placeholderV0 } from "./placeholder";
import { cardStateSchema } from "./schema";

describe("cardStateSchema", () => {
  it("accepts what the scheduler writes, after a trip through JSON", () => {
    const state = placeholderV0.next(placeholderV0.initial(), 3, new Date("2026-10-01T09:00:00Z"));
    const fromDatabase: unknown = JSON.parse(JSON.stringify(state));
    expect(cardStateSchema.parse(fromDatabase)).toEqual(state);
  });

  it("keeps fields that belong to another scheduler family", () => {
    const fsrs = { ...placeholderV0.initial(), kind: "fsrs", stability: 2.3, difficulty: 2.1 };
    expect(cardStateSchema.parse(fsrs)).toMatchObject({ stability: 2.3, difficulty: 2.1 });
  });

  it.each([
    ["an unknown kind", { kind: "anki" }],
    ["a date that is not ISO-8601", { due_at: "tomorrow" }],
    ["negative reps", { reps: -1 }],
    ["a missing field", { lapses: undefined }],
  ])("rejects %s", (_name, change) => {
    const corrupt = { ...placeholderV0.initial(), ...change };
    expect(cardStateSchema.safeParse(corrupt).success).toBe(false);
  });
});
