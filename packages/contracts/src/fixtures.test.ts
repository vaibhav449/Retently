import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { citationSchema } from "./citation";
import * as fixtures from "./fixtures";
import { itemSchema, mcqItemSchema } from "./item";
import { realtimeTokenResponseSchema } from "./realtime";
import {
  gradeSchema,
  reviewAnswerRequestSchema,
  reviewAnswerResponseSchema,
  reviewItemViewSchema,
  reviewNextResponseSchema,
  reviewResponseSchema,
  reviewSessionViewSchema,
} from "./review";
import { wsEnvelopeSchema } from "./ws";

const cases: [string, z.ZodType, unknown][] = [
  ["mcqItemFixture", itemSchema, fixtures.mcqItemFixture],
  ["clozeItemFixture", itemSchema, fixtures.clozeItemFixture],
  ["shortAnswerItemFixture", itemSchema, fixtures.shortAnswerItemFixture],
  ["noteCitationFixture", citationSchema, fixtures.noteCitationFixture],
  ["pdfCitationFixture", citationSchema, fixtures.pdfCitationFixture],
  ["reviewItemViewFixture", reviewItemViewSchema, fixtures.reviewItemViewFixture],
  ["reviewNextOkFixture", reviewNextResponseSchema, fixtures.reviewNextOkFixture],
  ["reviewNextDoneFixture", reviewNextResponseSchema, fixtures.reviewNextDoneFixture],
  ["reviewNextNothingDueFixture", reviewNextResponseSchema, fixtures.reviewNextNothingDueFixture],
  ["reviewAnswerRequestFixture", reviewAnswerRequestSchema, fixtures.reviewAnswerRequestFixture],
  [
    "reviewAnswerTextRequestFixture",
    reviewAnswerRequestSchema,
    fixtures.reviewAnswerTextRequestFixture,
  ],
  [
    "reviewAnswerMisconceptionFixture",
    reviewAnswerResponseSchema,
    fixtures.reviewAnswerMisconceptionFixture,
  ],
  ["reviewAnswerCorrectFixture", reviewAnswerResponseSchema, fixtures.reviewAnswerCorrectFixture],
  ["reviewAnswerGradingFixture", reviewAnswerResponseSchema, fixtures.reviewAnswerGradingFixture],
  ["reviewSessionViewFixture", reviewSessionViewSchema, fixtures.reviewSessionViewFixture],
  ["wsEnvelopeFixture", wsEnvelopeSchema, fixtures.wsEnvelopeFixture],
  [
    "realtimeTokenResponseFixture",
    realtimeTokenResponseSchema,
    fixtures.realtimeTokenResponseFixture,
  ],
];

describe("fixtures", () => {
  it.each(cases)("%s matches its schema", (_name, schema, fixture) => {
    expect(schema.safeParse(fixture).error).toBeUndefined();
  });

  it("every exported fixture has a case", () => {
    expect(cases.map(([name]) => name).sort()).toEqual(Object.keys(fixtures).sort());
  });
});

describe("item rules", () => {
  const [first, second] = fixtures.mcqItemFixture.options;

  it("rejects an MCQ whose answer_option_id is not one of its options", () => {
    const notAnOption = "8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b";
    const item = { ...fixtures.mcqItemFixture, answer_option_id: notAnOption };
    expect(mcqItemSchema.safeParse(item).success).toBe(false);
  });

  it("rejects an MCQ whose answer text is not the text of its answer option", () => {
    const item = { ...fixtures.mcqItemFixture, answer: "Ribosome" };
    expect(mcqItemSchema.safeParse(item).success).toBe(false);
  });

  it("rejects an MCQ with two options sharing an id", () => {
    const options = [first, { ...second, id: first?.id }];
    const item = { ...fixtures.mcqItemFixture, options };
    expect(mcqItemSchema.safeParse(item).success).toBe(false);
  });

  it("rejects an MCQ with two options sharing a text", () => {
    const options = [first, { ...second, text: first?.text }];
    const item = { ...fixtures.mcqItemFixture, options };
    expect(mcqItemSchema.safeParse(item).success).toBe(false);
  });

  it("rejects a cloze prompt without a blank", () => {
    const item = { ...fixtures.clozeItemFixture, prompt: "No blank here." };
    expect(itemSchema.safeParse(item).success).toBe(false);
  });
});

describe("review rules", () => {
  const view = fixtures.reviewItemViewFixture;

  it.each(["answer", "answer_option_id", "rubric", "correct"])(
    "rejects a presented item that carries %s",
    (key) => {
      const leaked = { ...view, item: { ...view.item, [key]: "leak" } };
      expect(reviewItemViewSchema.safeParse(leaked).success).toBe(false);
    },
  );

  it("rejects an MCQ presented without options, and a cloze presented with some", () => {
    const mcqWithout = { ...view, item: { ...view.item, options: [] } };
    const clozeWith = { ...view, item: { ...view.item, type: "cloze" } };
    expect(reviewItemViewSchema.safeParse(mcqWithout).success).toBe(false);
    expect(reviewItemViewSchema.safeParse(clozeWith).success).toBe(false);
  });

  it("rejects the old answer shape: an item id, the option's text and a trusted latency", () => {
    const old = {
      item_id: fixtures.mcqItemFixture.id,
      confidence: "sure",
      response: "Ribosome",
      latency_ms: 4200,
    };
    expect(reviewAnswerRequestSchema.safeParse(old).success).toBe(false);
  });

  it("names an MCQ answer by option id, never by text", () => {
    expect(reviewResponseSchema.safeParse({ kind: "mcq", option_id: "Ribosome" }).success).toBe(
      false,
    );
    expect(reviewResponseSchema.safeParse({ kind: "mcq", text: "Ribosome" }).success).toBe(false);
  });

  it("accepts only grades 1 to 4", () => {
    expect([0, 1, 2, 3, 4, 5].map((grade) => gradeSchema.safeParse(grade).success)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("rejects the old 'nothing due' shape, which could not tell done from empty", () => {
    expect(reviewNextResponseSchema.safeParse({ item: null }).success).toBe(false);
  });
});
