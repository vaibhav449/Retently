import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SynthConfig } from "./config";
import type { StudentRun } from "./simulate";

/** JSON with object keys sorted at every level: the same value always prints the same. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** A config's identity in the sidecar header: SHA-256 of its stable JSON, 16 hex digits. */
export function synthConfigHash(cfg: SynthConfig): string {
  return createHash("sha256").update(stableJson(cfg)).digest("hex").slice(0, 16);
}

export interface RunHeader {
  seed: string;
  end: Date;
  endDate: string;
  dates: readonly string[];
  students: number;
}

/**
 * The truth sidecar (REQ §6), as JSON lines: what the engine never sees, for later checks to
 * compare against (V1 oracle, V4 bias recovery, V5 misconception detection). One "run" line, then
 * per student a "student" line (the injected parameters) followed by its "review" lines in the
 * order they were recorded. Students in index order, whatever order they finished in, and no wall
 * clock anywhere, so the same seed and end give the same file. Only synthetic users appear.
 */
export function truthLines(header: RunHeader, runs: readonly StudentRun[], cfg: SynthConfig) {
  const lines: string[] = [
    stableJson({
      kind: "run",
      version: cfg.version,
      config_hash: synthConfigHash(cfg),
      seed: header.seed,
      end: header.end.toISOString(),
      end_date: header.endDate,
      first_date: header.dates[0] ?? null,
      days: header.dates.length,
      students: header.students,
      time_zone: cfg.timeZone,
    }),
  ];
  for (const run of [...runs].sort((a, b) => a.student.index - b.student.index)) {
    const { student, exam } = run;
    lines.push(
      stableJson({
        kind: "student",
        user_id: student.id,
        email: student.email,
        index: student.index,
        family: student.family,
        bias_group: student.biasGroup,
        bias: student.bias,
        w: student.w,
        ability: student.ability,
        speed: student.speed,
        adherence: student.adherence,
        session_hour: student.sessionHour,
        budget_sec: student.budgetSec,
        sessions: run.sessions,
        reviews: run.reviews.length,
        exam:
          exam === null
            ? null
            : {
                setup_date: exam.setupDate,
                exam_date: exam.examDate,
                days_after_end: exam.daysAfterEnd,
                topic_keys: exam.topicKeys,
                target: exam.target,
              },
      }),
    );
    for (const review of run.reviews) {
      lines.push(
        stableJson({
          kind: "review",
          review_id: review.reviewId,
          user_id: student.id,
          item_id: review.itemId,
          reviewed_at: review.reviewedAt,
          r_true: review.rTrue,
          p_correct: review.pCorrect,
          misconceived: review.misconceived,
          recalled: review.recalled,
          first_exposure: review.firstExposure,
        }),
      );
    }
  }
  return lines;
}

/** Writes the lines to `path`, creating its folder. */
export async function writeTruth(path: string, lines: readonly string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}
