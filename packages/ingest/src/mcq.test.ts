import { randomUUID } from "node:crypto";
import { mcqItemSchema } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { buildMcqItem, mcqPrompt } from "./mcq";

const chunkId = randomUUID();
const now = new Date("2026-11-03T10:00:00Z");
const draft = {
  question: "Which organelle makes most of the cell's ATP?",
  correct_answer: "Mitochondrion",
  wrong_answers: ["Ribosome", "Nucleus", "Golgi apparatus"],
};

describe("buildMcqItem", () => {
  it("builds an item in the agreed shape, graded by option id", () => {
    const item = buildMcqItem(draft, chunkId, now);
    expect(mcqItemSchema.parse(item)).toEqual(item);
    expect(item).toMatchObject({
      source_chunk_id: chunkId,
      prompt: draft.question,
      answer: "Mitochondrion",
      created_at: "2026-11-03T10:00:00.000Z",
      retired_at: null,
    });
    expect(item?.options.map((option) => option.text).sort()).toEqual(
      ["Golgi apparatus", "Mitochondrion", "Nucleus", "Ribosome"].sort(),
    );
    const right = item?.options.find((option) => option.id === item.answer_option_id);
    expect(right?.text).toBe("Mitochondrion");
  });

  it("shuffles the options before storing them", () => {
    // A source that always picks 0 moves the right answer from first to last.
    const item = buildMcqItem(draft, chunkId, now, () => 0);
    expect(item?.options.map((option) => option.text)).toEqual([
      "Ribosome",
      "Nucleus",
      "Golgi apparatus",
      "Mitochondrion",
    ]);
  });

  it("puts the right answer in every position over many items", () => {
    const positions = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const item = buildMcqItem(draft, chunkId, now);
      positions.add(item?.options.findIndex((option) => option.id === item.answer_option_id) ?? -1);
    }
    expect([...positions].sort()).toEqual([0, 1, 2, 3]);
  });

  it("drops a repeated wrong answer and trims whitespace", () => {
    const item = buildMcqItem(
      { ...draft, wrong_answers: [" Ribosome ", "ribosome", "Nucleus"] },
      chunkId,
      now,
    );
    expect(item?.options.map((option) => option.text).sort()).toEqual(
      ["Mitochondrion", "Nucleus", "Ribosome"].sort(),
    );
  });

  it("refuses a wrong answer that repeats the right one", () => {
    const item = buildMcqItem(
      { ...draft, wrong_answers: ["mitochondrion", "Ribosome"] },
      chunkId,
      now,
    );
    expect(item).toBeNull();
  });

  it("refuses a draft left with a single option", () => {
    expect(buildMcqItem({ ...draft, wrong_answers: ["  ", " "] }, chunkId, now)).toBeNull();
  });
});

describe("mcqPrompt", () => {
  it("sends the passage, with its headings when it has some", () => {
    expect(mcqPrompt({ heading: "Cells › Organelles", text: "Mitochondria make ATP." })).toBe(
      "<section>Cells › Organelles</section>\n\n<passage>\nMitochondria make ATP.\n</passage>",
    );
    expect(mcqPrompt({ heading: null, text: "Mitochondria make ATP." })).toBe(
      "<passage>\nMitochondria make ATP.\n</passage>",
    );
  });
});
