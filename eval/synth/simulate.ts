import type { Confidence, ReviewResponse } from "@repo/contracts";
import type { Database } from "@repo/db";
import {
  addLocalDays,
  type Clock,
  createDefaultRegistry,
  createExam,
  DEFAULT_EXAM,
  DEFAULT_GRADING,
  DEFAULT_QUEUE,
  getOrCreateSession,
  nextInSession,
  recordReview,
  startOfLocalDate,
  uuidv7,
} from "@repo/revision";
import { type AnswerTruth, answerItem, type ItemMind } from "./answer";
import type { BankItem } from "./bank";
import type { SynthConfig } from "./config";
import { createStudent, type OwnedItem, ownBank, release, sourceIdOf } from "./content";
import { Rng } from "./rng";
import type { Student } from "./student";
import { memoryFactory } from "./truth";

const HOUR_MS = 3_600_000;

/** The injected clock (REQ §1): the engine reads time only from here. */
export class SimClock implements Clock {
  constructor(private at: number) {}
  now(): Date {
    return new Date(this.at);
  }
  set(at: Date): void {
    this.at = at.getTime();
  }
  advance(ms: number): void {
    this.at += ms;
  }
}

/** One review line of the truth sidecar (REQ §6). */
export interface ReviewTruth extends AnswerTruth {
  reviewId: string;
  itemId: string;
  reviewedAt: string;
  confidence: Confidence;
  correct: boolean;
  latencyMs: number;
}

/** The exam a student set up during the simulation, as the sidecar records it. */
export interface ExamTruth {
  /** The simulated local day it was set up on. */
  setupDate: string;
  examDate: string;
  /** Local days from the end's local date to the exam date: the countdown at the end. */
  daysAfterEnd: number;
  topicKeys: string[];
  target: number;
}

/** What one student's simulation produced: the truth, and counts for the summary. */
export interface StudentRun {
  student: Student;
  reviews: ReviewTruth[];
  exam: (ExamTruth & { id: string }) | null;
  /** Local dates the student was active on (a session was built). */
  activeDates: string[];
  sessions: number;
}

/** When a student signs up: the first simulated day, an hour before its questions appear (SS-4). */
export function enrolledAt(firstDay: string, cfg: SynthConfig): Date {
  const start = startOfLocalDate(firstDay, cfg.timeZone).getTime();
  return new Date(start + (cfg.day.releaseHour - 1) * HOUR_MS);
}

export interface SimulateInput {
  db: Database;
  student: Student;
  bank: readonly BankItem[];
  /** The simulated local days, oldest first: the days before the end's local date. */
  dates: readonly string[];
  /** The end's local date (the first day not simulated). */
  endDate: string;
  /** The end itself: the end day's held-back questions appear by then at the latest. */
  end: Date;
  cfg: SynthConfig;
}

/**
 * One student, day by day (REQ §1, §5.1 of 09): new questions appear on their release day; an
 * exam is set up on its day; on an active day the student opens today's session, built by the
 * engine at the simulated time, and answers its entries in the engine's order, each answer drawn
 * from the hidden model and recorded through recordReview(). Nothing about grading, scheduling or
 * ranking is worked out here: the engine is called for all of it.
 */
export async function simulateStudent(input: SimulateInput): Promise<StudentRun> {
  const { db, student, cfg, dates } = input;
  const tz = cfg.timeZone;
  const firstDay = dates[0];
  if (firstDay === undefined) throw new Error("nothing to simulate: no days");

  const dayStart = (date: string) => startOfLocalDate(date, tz);
  const atHour = (date: string, hours: number) =>
    new Date(dayStart(date).getTime() + hours * HOUR_MS);

  const clock = new SimClock(enrolledAt(firstDay, cfg).getTime());
  const registry = createDefaultRegistry();
  const sessionDeps = { db, clock, registry, grading: DEFAULT_GRADING, queue: DEFAULT_QUEUE };
  const recordDeps = { db, clock, registry, grading: DEFAULT_GRADING };
  const examDeps = { db, clock, exam: DEFAULT_EXAM, queue: DEFAULT_QUEUE };

  await createStudent(db, student, clock.now(), cfg);

  const owned = ownBank(student, input.bank);
  const byId = new Map<string, OwnedItem>(owned.map((item) => [item.id, item]));
  const minds = new Map<string, ItemMind>();
  const newMemory = memoryFactory(
    { family: student.family, w: student.w, ability: student.ability },
    cfg,
  );
  const written = new Set<number>();

  const examRng = new Rng(student.id, "exam");
  const [soonest, latest] = cfg.exams.setupDaysBeforeEnd;
  const setupIndex =
    student.exam === "none"
      ? -1
      : Math.min(dates.length - 1, Math.max(1, dates.length - examRng.int(soonest, latest)));

  const run: StudentRun = { student, reviews: [], exam: null, activeDates: [], sessions: 0 };

  for (const [index, date] of dates.entries()) {
    const dayRng = new Rng(student.id, "day", date);

    // New questions appear before any session of the day; the student studies them then (SS-3).
    const releaseAt = atHour(date, cfg.day.releaseHour);
    for (const item of await release(db, student, owned, index, releaseAt, written, cfg)) {
      const difficulty = new Rng(student.id, "difficulty", item.bank.index).normal(
        0,
        cfg.fsrsTruth.difficultySigma,
      );
      const memory = newMemory(difficulty);
      memory.start(releaseAt, 3);
      minds.set(item.id, { memory, misconceived: false, exposures: 0 });
    }

    if (index === setupIndex) {
      clock.set(atHour(date, cfg.day.examSetupHour));
      run.exam = await setUpExam(
        student,
        [...written],
        input.endDate,
        date,
        examRng,
        examDeps,
        cfg,
      );
    }

    if (!dayRng.chance(student.adherence)) continue;
    const [earliest, latestHour] = cfg.day.sessionHours;
    const hour = Math.min(
      latestHour,
      Math.max(earliest, student.sessionHour + dayRng.normal(0, cfg.day.sessionJitterHours)),
    );
    clock.set(atHour(date, hour));

    // Opening /review: the engine builds today's plan at the simulated time.
    const today = await getOrCreateSession(student.id, sessionDeps);
    run.sessions += 1;
    run.activeDates.push(date);
    const planned = today.session.plan.length;
    if (planned === 0) continue;
    const limit = dayRng.chance(cfg.adherence.complete)
      ? Number.POSITIVE_INFINITY
      : dayRng.int(0, planned - 1);

    for (let answered = 0; answered < limit; answered++) {
      const next = await nextInSession(student.id, sessionDeps);
      if (next.kind !== "entry") break;
      const item = byId.get(next.entry.item_id);
      const mind = minds.get(next.entry.item_id);
      if (item === undefined || mind === undefined) {
        throw new Error(`the plan served ${next.entry.item_id}, which this student never got`);
      }
      if (item.bank.type !== "mcq") {
        throw new Error(
          `${item.bank.type} answers are not simulated: the engine cannot grade them`,
        );
      }

      const drawn = answerItem(
        mind,
        clock.now(),
        item.bank.type,
        item.wrongOptionIds.length,
        student,
        dayRng,
        cfg,
      );
      const chosen = drawn.correct ? item.answerOptionId : item.wrongOptionIds[drawn.wrongIndex];
      if (chosen === null || chosen === undefined) throw new Error(`item ${item.id} has no option`);
      const response: ReviewResponse = { kind: "mcq", option_id: chosen };

      clock.set(drawn.answeredAt);
      const reviewId = uuidv7(
        drawn.answeredAt,
        new Rng(student.id, "review", run.reviews.length).bytes(10),
      );
      const outcome = await recordReview(
        {
          reviewId,
          userId: student.id,
          itemId: item.id,
          context: "solo",
          confidence: drawn.confidence,
          response,
          latencyMs: drawn.latencyMs,
        },
        recordDeps,
      );
      if (outcome.correct !== drawn.correct) {
        throw new Error(`the engine graded ${reviewId} differently from the answer drawn`);
      }
      run.reviews.push({
        reviewId,
        itemId: item.id,
        reviewedAt: drawn.answeredAt.toISOString(),
        confidence: drawn.confidence,
        correct: drawn.correct,
        latencyMs: drawn.latencyMs,
        ...drawn.truth,
      });
      // Reading the reveal before the next question.
      clock.advance(cfg.revealMs);
    }
  }

  // The end day: only this morning's questions appear (SS-7); nobody has studied yet.
  const morning = atHour(input.endDate, cfg.day.releaseHour);
  await release(
    db,
    student,
    owned,
    "end",
    morning.getTime() < input.end.getTime() ? morning : input.end,
    written,
    cfg,
  );
  return run;
}

/**
 * The exam set-up screen, as the student would use it (REQ §3): a date after the simulated end, a
 * few of the notes they have, the default target or a high one. Through createExam(), so the
 * API's checks apply.
 */
async function setUpExam(
  student: Student,
  notes: readonly number[],
  endDate: string,
  today: string,
  rng: Rng,
  deps: Parameters<typeof createExam>[2],
  cfg: SynthConfig,
): Promise<StudentRun["exam"]> {
  const [fewest, most] = cfg.exams.scopeNotes;
  const [soonest, latest] = cfg.exams.daysAfterEnd;
  const daysAfterEnd = rng.int(soonest, latest);
  const examDate = addLocalDays(endDate, daysAfterEnd);
  const count = Math.min(notes.length, rng.int(fewest, most));
  const scope = rng
    .shuffle([...notes].sort((a, b) => a - b))
    .slice(0, count)
    .sort((a, b) => a - b);
  const topicKeys = scope.map((note) => `src:${sourceIdOf(student, note)}`);
  const target = student.exam === "high" ? cfg.exams.highTarget : null;

  const exam = await createExam(
    student.id,
    {
      exam_date: examDate,
      topic_keys: topicKeys,
      ...(target !== null && { target_retention: target }),
    },
    deps,
  );
  return {
    id: exam.id,
    setupDate: today,
    examDate,
    daysAfterEnd,
    topicKeys,
    target: exam.target_retention,
  };
}
