import type { Database } from "@repo/db";
import { addLocalDays, localDateOf } from "@repo/revision";
import { buildBank } from "./bank";
import { DEFAULT_SYNTH, type SynthConfig } from "./config";
import { createDemoCredential, DEMO_EMAIL, DEMO_PASSWORD } from "./demo";
import { deleteSyntheticUsers } from "./reset";
import { truthLines, writeTruth } from "./sidecar";
import { enrolledAt, simulateStudent, type StudentRun } from "./simulate";
import { DEMO_INDEX, drawStudent } from "./student";

export interface SeedOptions {
  db: Database;
  /** The cohort seed: with `end`, it fixes every row (V7). */
  seed: string;
  students: number;
  days: number;
  /**
   * The simulated "now": the simulation covers the `days` local days before its local date and
   * stops there, so on the end day items are due and exam countdowns are live. Always explicit:
   * only the CLI, the one top-level entry point, reads the wall clock (REQ §1).
   */
  end: Date;
  /** Create the demo student's sign-in credential. Refused in production by the CLI. */
  demo: boolean;
  /** Where to write the truth sidecar, or null to only return its lines. */
  truthPath: string | null;
  cfg?: SynthConfig;
  /** Progress lines; silent by default. */
  log?: (line: string) => void;
}

export interface SeedSummary {
  /** Synthetic users removed first (the previous cohort). */
  removed: number;
  runs: StudentRun[];
  /** The simulated local days, oldest first. */
  dates: string[];
  endDate: string;
  reviews: number;
  sessions: number;
  exams: number;
  /** The truth sidecar's lines, also written to truthPath when one was given. */
  truth: string[];
}

/**
 * `npm run db:seed` (REQ §4): replaces the synthetic cohort, never anyone else. Deletes every
 * synthetic user first, then simulates `students` students over `days` days through the real
 * engine, a few at a time (they share nothing, so the result does not depend on the order).
 */
export async function seedCohort(opts: SeedOptions): Promise<SeedSummary> {
  const cfg = opts.cfg ?? DEFAULT_SYNTH;
  const log = opts.log ?? (() => {});
  if (!Number.isInteger(opts.students) || opts.students < 1) {
    throw new RangeError("students must be a positive integer");
  }
  if (!Number.isInteger(opts.days) || opts.days < 1) {
    throw new RangeError("days must be a positive integer");
  }
  if (Number.isNaN(opts.end.getTime())) throw new RangeError("end is not a valid instant");

  const removed = await deleteSyntheticUsers(opts.db);
  if (removed > 0) log(`Removed the previous synthetic cohort: ${removed} users.`);

  const endDate = localDateOf(opts.end, cfg.timeZone);
  const dates = Array.from({ length: opts.days }, (_, i) => addLocalDays(endDate, i - opts.days));
  const bank = buildBank(cfg);
  const students = Array.from({ length: opts.students }, (_, i) => drawStudent(opts.seed, i, cfg));

  const runs: StudentRun[] = [];
  let nextIndex = 0;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      const student = students[nextIndex++];
      if (student === undefined) return;
      try {
        const started = Date.now();
        const run = await simulateStudent({
          db: opts.db,
          student,
          bank,
          dates,
          endDate,
          end: opts.end,
          cfg,
        });
        runs.push(run);
        log(
          `${student.email}: ${run.reviews.length} reviews in ${run.sessions} sessions` +
            `${run.exam === null ? "" : ", 1 exam"} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
        );
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(cfg.concurrency, students.length)) }, worker),
  );
  runs.sort((a, b) => a.student.index - b.student.index);

  const demo = students[DEMO_INDEX];
  if (opts.demo && demo !== undefined) {
    await createDemoCredential(opts.db, demo, enrolledAt(dates[0] as string, cfg));
    log(`Demo sign-in: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  }

  const truth = truthLines(
    { seed: opts.seed, end: opts.end, endDate, dates, students: students.length },
    runs,
    cfg,
  );
  if (opts.truthPath !== null) await writeTruth(opts.truthPath, truth);

  return {
    removed,
    runs,
    dates,
    endDate,
    reviews: runs.reduce((sum, run) => sum + run.reviews.length, 0),
    sessions: runs.reduce((sum, run) => sum + run.sessions, 0),
    exams: runs.filter((run) => run.exam !== null).length,
    truth,
  };
}
