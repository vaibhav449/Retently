import { digest } from "./rng";

/**
 * A uuid derived from the parts (V7): the first 16 bytes of their SHA-256, with the version 4 and
 * RFC 9562 variant bits set so every validator in the repo (z.uuid(), Postgres) takes it. The
 * generator mints every id it writes this way instead of with randomUUID(), so a second run with
 * the same seed writes the same ids.
 */
export function seededUuid(...parts: readonly (string | number)[]): string {
  const bytes = digest("uuid", ...parts).subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A synthetic student's users.id: "synth_", 8 hex digits of the cohort seed, the 1-based index.
 * The seed is part of the id, so `seed = hash(student id)` (09 §5.2) differs between cohorts.
 */
export function studentId(cohortSeed: string, index: number): string {
  const tag = digest("cohort", cohortSeed).toString("hex").slice(0, 8);
  return `synth_${tag}_${String(index + 1).padStart(2, "0")}`;
}
