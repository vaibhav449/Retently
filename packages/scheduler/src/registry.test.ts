import { describe, expect, it } from "vitest";
import { placeholderV0 } from "./placeholder";
import { createRegistry } from "./registry";
import type { Scheduler } from "./types";

// A second scheduler, so the registry has something to choose between.
const testV1: Scheduler = { ...placeholderV0, version: "test-v1" };

describe("createRegistry", () => {
  it("finds a scheduler by the version stored in card_state", () => {
    const registry = createRegistry([placeholderV0, testV1], "test-v1");
    expect(registry.get("placeholder-v0")).toBe(placeholderV0);
    expect(registry.get("test-v1")).toBe(testV1);
  });

  it("uses the active version for items that have never been reviewed", () => {
    expect(createRegistry([placeholderV0, testV1], "test-v1").active).toBe(testV1);
    expect(createRegistry([placeholderV0, testV1], "placeholder-v0").active).toBe(placeholderV0);
  });

  it("refuses an unknown version instead of guessing", () => {
    const registry = createRegistry([placeholderV0], "placeholder-v0");
    expect(() => registry.get("fsrs6-v1")).toThrow('Unknown scheduler version "fsrs6-v1"');
  });

  it("refuses an active version that is not registered", () => {
    expect(() => createRegistry([placeholderV0], "fsrs6-v1")).toThrow(
      'Unknown scheduler version "fsrs6-v1"',
    );
  });

  it("refuses two schedulers with the same version", () => {
    expect(() => createRegistry([placeholderV0, placeholderV0], "placeholder-v0")).toThrow(
      'Scheduler version "placeholder-v0" is registered twice',
    );
  });
});
