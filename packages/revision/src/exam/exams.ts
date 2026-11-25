import type { Exam, ExamListResponse } from "@repo/contracts";
import { type Database, itemsReadableBy } from "@repo/db";
import { z } from "zod";
import type { ExamConfig, QueueConfig } from "../config";
import type { Clock } from "../record/recordReview";
import { userTimeZone } from "../settings";
import { localDateOf, localDaysBetween, startOfLocalDate } from "../time";
import type { StoredExam } from "./forecast";
import type { ActiveExam } from "./term";
import {
  checkExamDate,
  ExamError,
  parseExamInput,
  parseExamUpdate,
  parseTopicKey,
} from "./validate";

export interface ExamDeps {
  db: Database;
  clock: Clock;
  exam: ExamConfig;
  /** servedTypes: which questions count for a note in examScopeOptions(). */
  queue: QueueConfig;
}

type ExamRow = Awaited<ReturnType<Database["exam"]["findUniqueOrThrow"]>>;
type ExamReader = Pick<Database, "exam">;

const uuid = z.uuid();

/** exams.exam_date is a DATE; Prisma reads and writes it as UTC midnight. */
function dateColumn(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

function storedExam(row: ExamRow): StoredExam {
  return {
    id: row.id,
    userId: row.userId,
    examDate: row.examDate.toISOString().slice(0, 10),
    topicKeys: row.topicKeys,
    target: row.targetRetention,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The sources a user may read, as a filter on sources: itemsReadableBy()'s rule one level up. */
function readableSources(userId: string) {
  return itemsReadableBy(userId).sourceChunk.source;
}

/** The titles of the readable notes among `keys`, by key. Unreadable and gone ones are missing. */
async function titlesOf(
  db: Database,
  userId: string,
  keys: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(keys.map(parseTopicKey).filter((id) => id !== null))];
  if (ids.length === 0) return new Map();
  const sources = await db.source.findMany({
    where: { id: { in: ids }, ...readableSources(userId) },
    select: { id: true, title: true },
  });
  return new Map(sources.map((source) => [`src:${source.id}`, source.title]));
}

/** The exam as the API returns it (examSchema), relative to the user's local `today`. */
function examView(exam: StoredExam, today: string, titles: ReadonlyMap<string, string>): Exam {
  const daysLeft = localDaysBetween(today, exam.examDate);
  return {
    id: exam.id,
    exam_date: exam.examDate,
    topic_keys: exam.topicKeys,
    target_retention: exam.target,
    days_left: daysLeft,
    status: daysLeft < 0 ? "past" : daysLeft === 0 ? "today" : "upcoming",
    scope: exam.topicKeys.map((key) => ({ key, title: titles.get(key) ?? null })),
    created_at: exam.createdAt.toISOString(),
  };
}

/**
 * Every key names a note the user can read (ER1.2, EM-15): one query through the same access rule
 * as the queue. Duplicates are dropped, first occurrence kept. Throws unreadable_scope.
 */
async function checkScope(
  db: Database,
  userId: string,
  keys: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(keys)];
  const readable = await titlesOf(db, userId, unique);
  if (unique.some((key) => !readable.has(key))) {
    throw new ExamError(
      "unreadable_scope",
      "One of the notes does not exist or is not yours.",
      "topic_keys",
    );
  }
  return unique;
}

/**
 * One exam create or move at a time per user, so two concurrent requests cannot both pass the
 * upcoming-exam limit. Released when the surrounding transaction ends.
 */
async function lockExams(tx: Pick<Database, "$executeRaw">, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`exams:${userId}`}))`;
}

async function checkUpcomingLimit(
  tx: ExamReader,
  userId: string,
  today: string,
  cfg: ExamConfig,
  excludeId?: string,
): Promise<void> {
  const upcoming = await tx.exam.count({
    where: {
      userId,
      examDate: { gte: dateColumn(today) },
      ...(excludeId !== undefined && { id: { not: excludeId } }),
    },
  });
  if (upcoming >= cfg.maxUpcomingExams) {
    throw new ExamError(
      "too_many_exams",
      `You can plan for at most ${cfg.maxUpcomingExams} upcoming exams.`,
    );
  }
}

/** The user's local today at the injected clock. */
async function todayOf(deps: ExamDeps, userId: string) {
  const now = deps.clock.now();
  const timeZone = await userTimeZone(deps.db, userId);
  return { now, timeZone, today: localDateOf(now, timeZone) };
}

/**
 * POST /api/exams (07 §6, ER2.1): validates the body (ExamError on a bad date, target or scope),
 * then creates the exam with created_at = updated_at = now. Takes effect in the queue from the
 * next session or "study more" (ER3.5).
 */
export async function createExam(userId: string, body: unknown, deps: ExamDeps): Promise<Exam> {
  const input = parseExamInput(body);
  const { now, today } = await todayOf(deps, userId);
  checkExamDate(input.exam_date, today, deps.exam);
  const topicKeys = await checkScope(deps.db, userId, input.topic_keys);

  const exam = await deps.db.$transaction(async (tx) => {
    await lockExams(tx, userId);
    await checkUpcomingLimit(tx, userId, today, deps.exam);
    return tx.exam.create({
      data: {
        userId,
        examDate: dateColumn(input.exam_date),
        topicKeys,
        targetRetention: input.target_retention ?? deps.exam.defaultTarget,
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  const stored = storedExam(exam);
  return examView(stored, today, await titlesOf(deps.db, userId, stored.topicKeys));
}

/** The user's exam with this id, or null: missing, someone else's, or not a uuid. */
export async function findExam(
  db: ExamReader,
  userId: string,
  examId: string,
): Promise<StoredExam | null> {
  if (!uuid.safeParse(examId).success) return null;
  const row = await db.exam.findFirst({ where: { id: examId, userId } });
  return row === null ? null : storedExam(row);
}

/** GET /api/exams/:id's exam, for the edit screen. Throws not_found. */
export async function getExam(userId: string, examId: string, deps: ExamDeps): Promise<Exam> {
  const exam = await findExam(deps.db, userId, examId);
  if (exam === null) throw new ExamError("not_found", "No such exam.");
  const { today } = await todayOf(deps, userId);
  return examView(exam, today, await titlesOf(deps.db, userId, exam.topicKeys));
}

/**
 * GET /api/exams (ER1.3, ER2.1): today's and upcoming exams by date (today's first), then, with
 * includePast, past ones newest first. Past exams are kept for history.
 */
export async function listExams(
  userId: string,
  opts: { includePast?: boolean },
  deps: ExamDeps,
): Promise<ExamListResponse> {
  const { today } = await todayOf(deps, userId);
  const rows = await deps.db.exam.findMany({
    where: { userId, ...(!opts.includePast && { examDate: { gte: dateColumn(today) } }) },
    orderBy: [{ examDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const exams = rows.map(storedExam);
  const titles = await titlesOf(
    deps.db,
    userId,
    exams.flatMap((exam) => exam.topicKeys),
  );
  const upcoming = exams.filter((exam) => exam.examDate >= today);
  const past = exams.filter((exam) => exam.examDate < today).reverse();
  return { exams: [...upcoming, ...past].map((exam) => examView(exam, today, titles)) };
}

/**
 * PATCH /api/exams/:id (ER2.1, EM-15): checks only the fields sent; a new date must be today or
 * later. updated_at = now, so the forecast cache misses (EM-13).
 */
export async function updateExam(
  userId: string,
  examId: string,
  body: unknown,
  deps: ExamDeps,
): Promise<Exam> {
  const existing = await findExam(deps.db, userId, examId);
  if (existing === null) throw new ExamError("not_found", "No such exam.");
  const patch = parseExamUpdate(body);
  const { now, today } = await todayOf(deps, userId);
  if (patch.exam_date !== undefined) checkExamDate(patch.exam_date, today, deps.exam);
  const topicKeys =
    patch.topic_keys === undefined
      ? undefined
      : await checkScope(deps.db, userId, patch.topic_keys);

  const exam = await deps.db.$transaction(async (tx) => {
    await lockExams(tx, userId);
    // Moving a past exam back into the future counts against the limit.
    if (patch.exam_date !== undefined && existing.examDate < today) {
      await checkUpcomingLimit(tx, userId, today, deps.exam, examId);
    }
    const { count } = await tx.exam.updateMany({
      where: { id: examId, userId },
      data: {
        ...(patch.exam_date !== undefined && { examDate: dateColumn(patch.exam_date) }),
        ...(topicKeys !== undefined && { topicKeys }),
        ...(patch.target_retention !== undefined && { targetRetention: patch.target_retention }),
        updatedAt: now,
      },
    });
    if (count === 0) throw new ExamError("not_found", "No such exam.");
    return tx.exam.findUniqueOrThrow({ where: { id: examId } });
  });
  const stored = storedExam(exam);
  return examView(stored, today, await titlesOf(deps.db, userId, stored.topicKeys));
}

/** DELETE /api/exams/:id. Throws not_found. Today's plan keeps the features it was built with. */
export async function deleteExam(userId: string, examId: string, deps: ExamDeps): Promise<void> {
  if (!uuid.safeParse(examId).success) throw new ExamError("not_found", "No such exam.");
  const { count } = await deps.db.exam.deleteMany({ where: { id: examId, userId } });
  if (count === 0) throw new ExamError("not_found", "No such exam.");
}

/** A note an exam can cover, for the setup screen. */
export interface ExamScopeOption {
  key: string;
  title: string;
  /** Live questions the review screen can serve. */
  items: number;
}

/**
 * The notes a user can put in an exam's scope (ER5.1): every readable source, newest first, with
 * its count of live, servable questions.
 */
export async function examScopeOptions(
  userId: string,
  deps: Pick<ExamDeps, "db" | "queue">,
): Promise<ExamScopeOption[]> {
  const [sources, items] = await Promise.all([
    deps.db.source.findMany({
      where: readableSources(userId),
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true, title: true },
    }),
    deps.db.item.findMany({
      where: {
        ...itemsReadableBy(userId),
        retiredAt: null,
        type: { in: [...deps.queue.servedTypes] },
      },
      select: { sourceChunk: { select: { sourceId: true } } },
    }),
  ]);
  const counts = new Map<string, number>();
  for (const item of items) {
    const sourceId = item.sourceChunk.sourceId;
    counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
  }
  return sources.map((source) => ({
    key: `src:${source.id}`,
    title: source.title,
    items: counts.get(source.id) ?? 0,
  }));
}

/**
 * The exams the queue plans for at `now` (07 §4.3, ER1.3): the user's exams whose exam_at (the
 * start of exam_date in `timeZone`) is after now. On the exam day itself the exam is no longer
 * active (EM-7). Sorted by id, so meta.exam_ids is stable.
 */
export async function activeExams(
  db: ExamReader,
  userId: string,
  now: Date,
  timeZone: string,
): Promise<ActiveExam[]> {
  const rows = await db.exam.findMany({
    where: { userId, examDate: { gte: dateColumn(localDateOf(now, timeZone)) } },
    orderBy: { id: "asc" },
  });
  return rows
    .map(storedExam)
    .map((exam) => ({
      id: exam.id,
      examAt: startOfLocalDate(exam.examDate, timeZone),
      examDate: exam.examDate,
      target: exam.target,
      scope: new Set(exam.topicKeys),
    }))
    .filter((exam) => exam.examAt.getTime() > now.getTime());
}
