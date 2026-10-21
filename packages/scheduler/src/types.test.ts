import { describe, expectTypeOf, it } from "vitest";
import type { CardState, Grade, Scheduler } from "./types";

// These are checked by `tsc` (npm run typecheck), not at runtime.
describe("types", () => {
  it("Grade is exactly 1 | 2 | 3 | 4", () => {
    expectTypeOf<Grade>().toEqualTypeOf<1 | 2 | 3 | 4>();
  });

  it("CardState stores dates as strings, so it survives JSON", () => {
    expectTypeOf<CardState["last_review_at"]>().toEqualTypeOf<string | null>();
    expectTypeOf<CardState["due_at"]>().toEqualTypeOf<string | null>();
  });

  it("Scheduler.next takes the time as an argument instead of reading a clock", () => {
    expectTypeOf<Scheduler["next"]>().parameter(2).toEqualTypeOf<Date>();
  });
});
