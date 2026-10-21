import { mcqItemFixture } from "@repo/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { ReviewError } from "../errors";
import { type GradableItem, gradeLocally } from "./gradeResponse";

const mcq: GradableItem = {
  type: "mcq",
  options: mcqItemFixture.options,
  answerOptionId: mcqItemFixture.answer_option_id,
};
const [ribosome] = mcqItemFixture.options;

function codeOf(grade: () => unknown): string | undefined {
  try {
    grade();
  } catch (error) {
    if (error instanceof ReviewError) return error.code;
    throw error;
  }
  return undefined;
}

describe("gradeLocally", () => {
  it("is correct when the chosen option is the answer option", () => {
    const answer = { kind: "mcq", option_id: mcqItemFixture.answer_option_id } as const;
    expect(gradeLocally(mcq, answer)).toBe(true);
  });

  it("is wrong when another option is chosen", () => {
    expect(gradeLocally(mcq, { kind: "mcq", option_id: ribosome?.id ?? "" })).toBe(false);
  });

  it("refuses an option id that is not one of the item's options (422)", () => {
    const stranger = { kind: "mcq", option_id: "8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b" } as const;
    expect(codeOf(() => gradeLocally(mcq, stranger))).toBe("invalid_response");
  });

  it("refuses a typed answer to an MCQ (422)", () => {
    expect(codeOf(() => gradeLocally(mcq, { kind: "text", text: "Mitochondrion" }))).toBe(
      "invalid_response",
    );
  });

  it("does not grade cloze or short answers yet", () => {
    const cloze: GradableItem = { type: "cloze", options: [], answerOptionId: null };
    expect(codeOf(() => gradeLocally(cloze, { kind: "text", text: "thylakoid" }))).toBe(
      "not_gradable",
    );
  });
});
