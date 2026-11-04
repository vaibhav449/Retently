import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chunkMarkdown, DEFAULT_CHUNKING } from "./chunker";
import { contentHash } from "./hash";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.md`, import.meta.url), "utf8");

describe("chunkMarkdown on the fixture notes", () => {
  for (const name of ["biology", "history", "programming"]) {
    it(`chunks ${name}.md the same way every time`, () => {
      const chunks = chunkMarkdown(fixture(name));
      expect(chunks).toMatchSnapshot();
      expect(chunkMarkdown(fixture(name))).toEqual(chunks);
    });
  }

  it("starts a chunk at every heading and keeps the headings above it", () => {
    const headings = chunkMarkdown(fixture("history")).map((chunk) => chunk.heading);
    expect(headings).toEqual([
      "The French Revolution",
      "The French Revolution › Causes",
      "The French Revolution › Causes › The storming of the Bastille",
    ]);
  });

  it("drops chunks too short for a fair question", () => {
    const texts = chunkMarkdown(fixture("biology")).map((chunk) => chunk.text);
    expect(texts.some((text) => text.includes("Revise this."))).toBe(false);
  });

  it("keeps a fenced code block whole, blank lines included", () => {
    const [closures] = chunkMarkdown(fixture("programming"));
    expect(closures?.text).toContain("let count = 0;\n\n  return () => ++count;");
  });
});

describe("chunkMarkdown", () => {
  // 13 words: just over the minimum, so it is kept on its own.
  const sentence =
    "Mitochondria are the site of aerobic respiration in nearly every animal cell today.";

  it("returns nothing for an empty note", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("# Only a heading")).toEqual([]);
  });

  it("hashes the text without the heading, ignoring whitespace", () => {
    const [chunk] = chunkMarkdown(`## Cells\n\n${sentence}   It has two membranes.`);
    expect(chunk?.text).toBe(`${sentence}   It has two membranes.`);
    expect(chunk?.contentHash).toBe(contentHash(`${sentence} It has two membranes.`));
  });

  it("gives an edited paragraph a new hash and leaves the others alone", () => {
    const other = "The nucleus holds the DNA of the cell and controls protein synthesis.";
    const before = chunkMarkdown(`# A\n\n${sentence}\n\n# B\n\n${other}`);
    const after = chunkMarkdown(`# A\n\n${sentence} Edited.\n\n# B\n\n${other}`);
    expect(after[0]?.contentHash).not.toBe(before[0]?.contentHash);
    expect(after[1]?.contentHash).toBe(before[1]?.contentHash);
  });

  it("keeps a passage that appears twice once", () => {
    expect(chunkMarkdown(`# A\n\n${sentence}\n\n# B\n\n${sentence}`)).toHaveLength(1);
  });

  it("groups short paragraphs and splits before a chunk grows past the maximum", () => {
    const options = { ...DEFAULT_CHUNKING, targetWords: 20, maxWords: 25 };
    const paragraph = "one two three four five six seven eight nine ten eleven twelve";
    const chunks = chunkMarkdown([paragraph, paragraph, paragraph].join("\n\n"), options);
    expect(chunks.map((chunk) => chunk.words)).toEqual([24, 12]);
  });

  it("treats Windows line endings like Unix ones", () => {
    const unix = `# Cells\n\n${sentence}\n`;
    expect(chunkMarkdown(unix.replace(/\n/g, "\r\n"))).toEqual(chunkMarkdown(unix));
  });
});
