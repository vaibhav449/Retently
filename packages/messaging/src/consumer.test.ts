import { ingestRequestedJobSchema } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { describeInvalid } from "./consumer";

/** The error a value throws when parsed the way the consumer parses a delivery. */
function parseError(content: string): unknown {
  try {
    ingestRequestedJobSchema.parse(JSON.parse(content));
  } catch (error) {
    return error;
  }
  throw new Error("expected the content to be invalid");
}

describe("describeInvalid", () => {
  it("says when the body is not JSON", () => {
    expect(describeInvalid(parseError("{not json"))).toBe("not JSON");
  });

  it("lists the fields the contract rejects, one line for the parking lot", () => {
    expect(describeInvalid(parseError('{"type":"ingest.requested","v":1}'))).toBe(
      "source_id: Invalid input: expected string, received undefined; " +
        "version: Invalid input: expected number, received undefined",
    );
  });
});
