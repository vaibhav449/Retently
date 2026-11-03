import { contentHash } from "./hash";

export interface ChunkingOptions {
  /** Chunks with fewer words are too short for a fair question and are skipped. */
  minWords: number;
  /** A chunk is closed once it reaches this many words. */
  targetWords: number;
  /** A paragraph that would take a chunk past this starts a new one. */
  maxWords: number;
}

export const DEFAULT_CHUNKING: ChunkingOptions = { minWords: 12, targetWords: 150, maxWords: 300 };

export interface ChunkDraft {
  /** The headings the chunk sits under, outermost first, e.g. "Cells › Organelles". */
  heading: string | null;
  /** The chunk's paragraphs as Markdown, without the heading, so it reads well as a snippet. */
  text: string;
  contentHash: string;
  words: number;
}

type Block = { kind: "heading"; level: number; text: string } | { kind: "text"; text: string };

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Headings and paragraphs, in order. A fenced code block stays whole, blank lines included. */
function blocksOf(markdown: string): Block[] {
  const blocks: Block[] = [];
  let lines: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const text = lines.join("\n").trim();
    if (text) blocks.push({ kind: "text", text });
    lines = [];
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      lines.push(line);
      if (line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    const opening = FENCE.exec(line);
    if (opening?.[1]) {
      fence = opening[1];
      lines.push(line);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    if (line.trim() === "") flush();
    else lines.push(line);
  }
  flush();
  return blocks;
}

/**
 * Splits a note's Markdown into chunks: a heading always starts a new chunk, and paragraphs under
 * it are grouped up to about `targetWords`. Chunks too short for a fair question are dropped, and
 * a passage that appears twice is kept once. The same Markdown always gives the same chunks.
 */
export function chunkMarkdown(
  markdown: string,
  options: ChunkingOptions = DEFAULT_CHUNKING,
): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  const seen = new Set<string>();
  const path: string[] = [];
  let paragraphs: string[] = [];
  let words = 0;

  const flush = () => {
    if (paragraphs.length > 0 && words >= options.minWords) {
      const text = paragraphs.join("\n\n");
      const hash = contentHash(text);
      if (!seen.has(hash)) {
        seen.add(hash);
        const heading = path.filter(Boolean).join(" › ");
        chunks.push({ heading: heading || null, text, contentHash: hash, words });
      }
    }
    paragraphs = [];
    words = 0;
  };

  for (const block of blocksOf(markdown)) {
    if (block.kind === "heading") {
      flush();
      path.length = block.level - 1;
      path[block.level - 1] = block.text;
      continue;
    }
    const blockWords = countWords(block.text);
    if (words > 0 && words + blockWords > options.maxWords) flush();
    paragraphs.push(block.text);
    words += blockWords;
    if (words >= options.targetWords) flush();
  }
  flush();
  return chunks;
}
