import { describe, expect, it } from "vitest";
import {
  DOCUMENT_MARKDOWN_MAX,
  documentTitleSchema,
  updateDocumentRequestSchema,
} from "./document";

const doc = { type: "doc", content: [{ type: "paragraph", attrs: { id: "b1" } }] };

describe("documentTitleSchema", () => {
  it("trims the title", () => {
    expect(documentTitleSchema.parse("  Cell biology ")).toBe("Cell biology");
  });

  it("rejects a blank title", () => {
    expect(documentTitleSchema.safeParse("   ").success).toBe(false);
  });
});

describe("updateDocumentRequestSchema", () => {
  it("accepts a rename", () => {
    expect(updateDocumentRequestSchema.parse({ title: "Notes" })).toEqual({ title: "Notes" });
  });

  it("accepts a save", () => {
    const save = { content_json: doc, content_md: "Hello", base_version: 0 };
    expect(updateDocumentRequestSchema.parse(save)).toEqual(save);
  });

  it("rejects a rename and a save in one request", () => {
    const both = { title: "Notes", content_json: doc, content_md: "", base_version: 0 };
    expect(updateDocumentRequestSchema.safeParse(both).success).toBe(false);
  });

  it("rejects content that is not a TipTap doc", () => {
    for (const content_json of [null, [], "doc", { type: "paragraph" }]) {
      const save = { content_json, content_md: "", base_version: 0 };
      expect(updateDocumentRequestSchema.safeParse(save).success).toBe(false);
    }
  });

  it("rejects a save without a base version", () => {
    expect(
      updateDocumentRequestSchema.safeParse({ content_json: doc, content_md: "" }).success,
    ).toBe(false);
  });

  it("rejects Markdown over the limit", () => {
    const save = {
      content_json: doc,
      content_md: "a".repeat(DOCUMENT_MARKDOWN_MAX + 1),
      base_version: 0,
    };
    expect(updateDocumentRequestSchema.safeParse(save).success).toBe(false);
  });
});
