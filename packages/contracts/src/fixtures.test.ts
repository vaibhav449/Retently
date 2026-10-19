import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { citationSchema } from "./citation";
import * as fixtures from "./fixtures";
import { itemSchema, mcqItemSchema } from "./item";
import {
  reviewAnswerRequestSchema,
  reviewAnswerResponseSchema,
  reviewNextResponseSchema,
  reviewQuestionSchema,
} from "./review";
import { wsEnvelopeSchema } from "./ws";

const cases: [string, z.ZodType, unknown][] = [
  ["mcqItemFixture", itemSchema, fixtures.mcqItemFixture],
  ["clozeItemFixture", itemSchema, fixtures.clozeItemFixture],
  ["shortAnswerItemFixture", itemSchema, fixtures.shortAnswerItemFixture],
  ["noteCitationFixture", citationSchema, fixtures.noteCitationFixture],
  ["pdfCitationFixture", citationSchema, fixtures.pdfCitationFixture],
  ["reviewNextResponseFixture", reviewNextResponseSchema, fixtures.reviewNextResponseFixture],
  ["reviewNextEmptyFixture", reviewNextResponseSchema, fixtures.reviewNextEmptyFixture],
  ["reviewAnswerRequestFixture", reviewAnswerRequestSchema, fixtures.reviewAnswerRequestFixture],
  ["reviewAnswerWrongFixture", reviewAnswerResponseSchema, fixtures.reviewAnswerWrongFixture],
  ["reviewAnswerCorrectFixture", reviewAnswerResponseSchema, fixtures.reviewAnswerCorrectFixture],
  ["wsEnvelopeFixture", wsEnvelopeSchema, fixtures.wsEnvelopeFixture],
];

describe("fixtures", () => {
  it.each(cases)("%s matches its schema", (_name, schema, fixture) => {
    expect(schema.safeParse(fixture).error).toBeUndefined();
  });

  it("every exported fixture has a case", () => {
    expect(cases.map(([name]) => name).sort()).toEqual(Object.keys(fixtures).sort());
  });
});

describe("contract rules", () => {
  it("rejects an MCQ whose answer is not one of its options", () => {
    const item = { ...fixtures.mcqItemFixture, answer: "Nucleus" };
    expect(mcqItemSchema.safeParse(item).success).toBe(false);
  });

  it("rejects an MCQ with duplicate options", () => {
    const item = { ...fixtures.mcqItemFixture, options: ["Mitochondrion", "Mitochondrion"] };
    expect(mcqItemSchema.safeParse(item).success).toBe(false);
  });

  it("rejects a cloze prompt without a blank", () => {
    const item = { ...fixtures.clozeItemFixture, prompt: "No blank here." };
    expect(itemSchema.safeParse(item).success).toBe(false);
  });

  it("rejects a review question that leaks the answer", () => {
    const leaked = { ...fixtures.reviewNextResponseFixture.item, answer: "Mitochondrion" };
    expect(reviewQuestionSchema.safeParse(leaked).success).toBe(false);
  });
});
