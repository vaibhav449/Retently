import { mcqItemSchema } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { buildBank, chunkCount, NOTES } from "./bank";
import { DEFAULT_SYNTH } from "./config";
import { seededUuid } from "./ids";

describe("the question bank", () => {
  const bank = buildBank(DEFAULT_SYNTH);

  it("has about 150 questions over 8 notes, MCQ only by default", () => {
    expect(NOTES).toHaveLength(8);
    expect(bank).toHaveLength(152);
    expect(new Set(bank.map((item) => item.type))).toEqual(new Set(["mcq"]));
  });

  it("makes every MCQ valid under the item contract, with four distinct options", () => {
    for (const item of bank) {
      const options = item.options.map((text, k) => ({
        id: seededUuid("test", item.index, k),
        text,
      }));
      const answer = options.find((option) => option.text === item.answer);
      expect(options).toHaveLength(4);
      const parsed = mcqItemSchema.safeParse({
        id: seededUuid("test", item.index),
        source_chunk_id: seededUuid("chunk", item.note, item.chunk),
        type: "mcq",
        prompt: item.prompt,
        answer: item.answer,
        options,
        answer_option_id: answer?.id,
        rubric: null,
        difficulty_seed: null,
        created_at: "2026-11-01T00:00:00.000Z",
        retired_at: null,
      });
      expect(parsed.success, `${item.prompt}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it("releases 30 questions every 7 days from day 0, and the last 6 on the end day", () => {
    const byDay = new Map<number | "end", number>();
    for (const item of bank) byDay.set(item.releaseDay, (byDay.get(item.releaseDay) ?? 0) + 1);
    expect([...byDay.entries()]).toEqual([
      [0, 30],
      [7, 30],
      [14, 30],
      [21, 30],
      [28, 26],
      ["end", 6],
    ]);
    const order = bank.map((item) => item.note * 100 + item.fact);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("puts each question on a chunk of its note", () => {
    for (const item of bank) {
      expect(item.chunk).toBeGreaterThanOrEqual(0);
      expect(item.chunk).toBeLessThan(chunkCount(item.note, DEFAULT_SYNTH));
    }
  });

  it("is the same on every call (the templates are deterministic)", () => {
    expect(buildBank(DEFAULT_SYNTH)).toEqual(bank);
  });

  it("follows the type mix when cloze is switched on", () => {
    const mixed = buildBank({
      ...DEFAULT_SYNTH,
      content: { ...DEFAULT_SYNTH.content, typeMix: { mcq: 0.7, cloze: 0.3 } },
    });
    const cloze = mixed.filter((item) => item.type === "cloze");
    expect(cloze.length).toBeGreaterThan(20);
    expect(cloze.length).toBeLessThan(80);
    for (const item of cloze) {
      expect(item.prompt).toContain("____");
      expect(item.options).toEqual([]);
    }
  });
});
