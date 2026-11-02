import { describe, expect, it } from "vitest";
import { decideOnError, PermanentError } from "./decide";

describe("decideOnError", () => {
  it("retries a failure while attempts are left", () => {
    expect(decideOnError(new Error("LLM timeout"), 1, 3)).toEqual({ kind: "retry" });
    expect(decideOnError(new Error("LLM timeout"), 2, 3)).toEqual({ kind: "retry" });
  });

  it("gives up on the last attempt, saying how many there were", () => {
    expect(decideOnError(new Error("LLM timeout"), 3, 3)).toEqual({
      kind: "give_up",
      reason: "failed 3 times: LLM timeout",
    });
  });

  it("gives up at once on a permanent error", () => {
    expect(decideOnError(new PermanentError("source has no text"), 1, 3)).toEqual({
      kind: "give_up",
      reason: "source has no text",
    });
  });

  it("describes a thrown value that is not an Error", () => {
    expect(decideOnError("boom", 3, 3)).toEqual({
      kind: "give_up",
      reason: "failed 3 times: boom",
    });
  });
});
