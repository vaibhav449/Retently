import { createHash } from "node:crypto";

/** Whitespace never changes what a passage says, so it never changes its hash. */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * The fingerprint of a chunk's text: the same text always gives the same hash, and any other
 * change gives a new one. Items are generated once per hash (build-plan §10.6).
 */
export function contentHash(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex");
}
