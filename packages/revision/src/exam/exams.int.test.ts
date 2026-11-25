import { randomUUID } from "node:crypto";
import { examListResponseSchema, examSchema } from "@repo/contracts";
import { createDb, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEFAULT_EXAM, DEFAULT_QUEUE } from "../config";
import { seedExam, seedItem, seedMcqs, seedUser, setTimeZone } from "../test/seed";
import {
  activeExams,
  createExam,
  deleteExam,
  type ExamDeps,
  examScopeOptions,
  getExam,
  listExams,
  updateExam,
} from "./exams";
import { ExamError, type ExamErrorCode } from "./validate";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = createDb(inject("databaseUrl")));
});

afterAll(() => close());

/** 09:00 IST on 19 Nov 2026: "today" is 2026-11-19 for a user without settings (Asia/Kolkata). */
const NOW = new Date("2026-11-19T03:30:00.000Z");
const deps = (now = NOW): ExamDeps => ({
  db,
  clock: { now: () => now },
  exam: DEFAULT_EXAM,
  queue: DEFAULT_QUEUE,
});

/** A user with `notes` notes of one MCQ each; their topic keys. */
async function student(notes = 2) {
  const userId = await seedUser(db);
  const { sourceIds } = await seedMcqs(db, userId, notes, { sources: notes });
  return { userId, keys: sourceIds.map((id) => `src:${id}`), sourceIds };
}

async function refused(
  promise: Promise<unknown>,
): Promise<{ code: ExamErrorCode; field?: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExamError) return { code: error.code, field: error.field };
    throw error;
  }
  throw new Error("expected an ExamError");
}

describe("the exams table (ER1.1, 03 §2.3, EM-5)", () => {
  it("stores 0.9 as exactly 0.9 (double precision, not real)", async () => {
    const { userId, sourceIds } = await student(1);
    const id = await seedExam(db, userId, { examDate: "2026-12-03", sourceIds, target: 0.9 });
    const row = await db.exam.findUniqueOrThrow({ where: { id } });
    expect(row.targetRetention).toBe(0.9);
    const [raw] = await db.$queryRaw<
      { t: number }[]
    >`SELECT target_retention AS t FROM exams WHERE id = ${id}::uuid`;
    expect(raw?.t).toBe(0.9);
  });

  it("refuses an empty scope and a target outside 0.8–0.97 (CHECKs)", async () => {
    const { userId, sourceIds } = await student(1);
    await expect(seedExam(db, userId, { examDate: "2026-12-03", topicKeys: [] })).rejects.toThrow();
    await expect(
      seedExam(db, userId, { examDate: "2026-12-03", sourceIds, target: 0.98 }),
    ).rejects.toThrow();
    await expect(
      seedExam(db, userId, { examDate: "2026-12-03", sourceIds, target: 0.79 }),
    ).rejects.toThrow();
  });

  it("deletes a user's exams with the user (E24)", async () => {
    const { userId, sourceIds } = await student(1);
    const id = await seedExam(db, userId, { examDate: "2026-12-03", sourceIds });
    await db.user.delete({ where: { id: userId } });
    expect(await db.exam.findUnique({ where: { id } })).toBeNull();
  });
});

describe("createExam (ER2.1, EA7)", () => {
  it("creates an exam with the default target, its scope titled, created_at from the clock", async () => {
    const { userId, keys } = await student(2);
    const exam = await createExam(userId, { exam_date: "2026-12-03", topic_keys: keys }, deps());
    expect(examSchema.safeParse(exam).success).toBe(true);
    expect(exam).toMatchObject({
      exam_date: "2026-12-03",
      topic_keys: keys,
      target_retention: 0.9,
      days_left: 14,
      status: "upcoming",
      created_at: NOW.toISOString(),
    });
    expect(exam.scope.map((entry) => entry.title)).toEqual(["Note 1", "Note 2"]);
  });

  it("drops duplicate keys and accepts today", async () => {
    const { userId, keys } = await student(1);
    const key = keys[0] as string;
    const exam = await createExam(
      userId,
      { exam_date: "2026-11-19", topic_keys: [key, key], target_retention: 0.95 },
      deps(),
    );
    expect(exam).toMatchObject({ topic_keys: [key], status: "today", days_left: 0 });
  });

  it("checks today in the user's own zone (ER1.4)", async () => {
    const { userId, keys } = await student(1);
    // 03:30 UTC on the 19th is still the 18th in New York.
    await setTimeZone(db, userId, "America/New_York");
    const exam = await createExam(userId, { exam_date: "2026-11-18", topic_keys: keys }, deps());
    expect(exam.status).toBe("today");
  });

  it.each<[string, (keys: string[]) => unknown, ExamErrorCode, string | undefined]>([
    [
      "a past date",
      (keys) => ({ exam_date: "2026-11-18", topic_keys: keys }),
      "invalid_date",
      "exam_date",
    ],
    [
      "a malformed date",
      (keys) => ({ exam_date: "19/11/2026", topic_keys: keys }),
      "invalid_date",
      "exam_date",
    ],
    [
      "a date over a year ahead",
      (keys) => ({ exam_date: "2027-11-21", topic_keys: keys }),
      "date_too_far",
      "exam_date",
    ],
    [
      "target 0.79",
      (keys) => ({ exam_date: "2026-12-03", topic_keys: keys, target_retention: 0.79 }),
      "invalid_target",
      "target_retention",
    ],
    [
      "target 0.98",
      (keys) => ({ exam_date: "2026-12-03", topic_keys: keys, target_retention: 0.98 }),
      "invalid_target",
      "target_retention",
    ],
    [
      "a target that is not a number",
      (keys) => ({ exam_date: "2026-12-03", topic_keys: keys, target_retention: "high" }),
      "invalid_target",
      "target_retention",
    ],
    [
      "an empty scope",
      () => ({ exam_date: "2026-12-03", topic_keys: [] }),
      "empty_scope",
      "topic_keys",
    ],
    [
      "a malformed key",
      () => ({ exam_date: "2026-12-03", topic_keys: ["source:abc"] }),
      "unreadable_scope",
      "topic_keys",
    ],
    [
      "a note that does not exist",
      () => ({ exam_date: "2026-12-03", topic_keys: [`src:${randomUUID()}`] }),
      "unreadable_scope",
      "topic_keys",
    ],
    [
      "an unknown field",
      (keys) => ({ exam_date: "2026-12-03", topic_keys: keys, topic_ids: [] }),
      "invalid_request",
      undefined,
    ],
    ["not an object", () => "exam", "invalid_request", undefined],
  ])("refuses %s", async (_case, body, code, field) => {
    const { userId, keys } = await student(1);
    expect(await refused(createExam(userId, body(keys), deps()))).toEqual({ code, field });
    expect(await db.exam.count({ where: { userId } })).toBe(0);
  });

  it("refuses someone else's note (EA7)", async () => {
    const { userId } = await student(1);
    const stranger = await student(1);
    const body = { exam_date: "2026-12-03", topic_keys: stranger.keys };
    expect((await refused(createExam(userId, body, deps()))).code).toBe("unreadable_scope");
  });

  it("refuses an 11th upcoming exam, but past exams do not count (E7)", async () => {
    const { userId, keys, sourceIds } = await student(1);
    await seedExam(db, userId, { examDate: "2026-11-01", sourceIds });
    for (let i = 0; i < 10; i += 1) {
      await createExam(userId, { exam_date: "2026-12-03", topic_keys: keys }, deps());
    }
    const body = { exam_date: "2026-12-04", topic_keys: keys };
    expect((await refused(createExam(userId, body, deps()))).code).toBe("too_many_exams");
  });
});

describe("listExams, getExam (ER1.3)", () => {
  it("lists today's exam, then upcoming by date; past ones only on request, newest first", async () => {
    const { userId, sourceIds } = await student(1);
    const later = await seedExam(db, userId, { examDate: "2026-12-20", sourceIds });
    const soon = await seedExam(db, userId, { examDate: "2026-11-25", sourceIds });
    const today = await seedExam(db, userId, { examDate: "2026-11-19", sourceIds });
    const old = await seedExam(db, userId, { examDate: "2026-10-01", sourceIds });
    const recent = await seedExam(db, userId, { examDate: "2026-11-10", sourceIds });

    const active = await listExams(userId, {}, deps());
    expect(examListResponseSchema.safeParse(active).success).toBe(true);
    expect(active.exams.map((exam) => exam.id)).toEqual([today, soon, later]);
    const all = await listExams(userId, { includePast: true }, deps());
    expect(all.exams.map((exam) => exam.id)).toEqual([today, soon, later, recent, old]);
    expect(all.exams.map((exam) => exam.status)).toEqual([
      "today",
      "upcoming",
      "upcoming",
      "past",
      "past",
    ]);
    expect(all.exams.at(-1)?.days_left).toBe(-49);
  });

  it("titles a deleted note's key null, and keeps the key (E8)", async () => {
    const { userId, keys, sourceIds } = await student(2);
    const exam = await createExam(userId, { exam_date: "2026-12-03", topic_keys: keys }, deps());
    await db.source.delete({ where: { id: sourceIds[1] } });
    const view = await getExam(userId, exam.id, deps());
    expect(view.topic_keys).toEqual(keys);
    expect(view.scope.map((entry) => entry.title)).toEqual(["Note 1", null]);
  });

  it("hides another user's exam: not_found (EA6, E22)", async () => {
    const owner = await student(1);
    const exam = await createExam(
      owner.userId,
      { exam_date: "2026-12-03", topic_keys: owner.keys },
      deps(),
    );
    const stranger = await seedUser(db);
    expect((await refused(getExam(stranger, exam.id, deps()))).code).toBe("not_found");
    expect((await refused(getExam(owner.userId, "not-a-uuid", deps()))).code).toBe("not_found");
    expect((await listExams(stranger, { includePast: true }, deps())).exams).toEqual([]);
  });
});

describe("updateExam, deleteExam", () => {
  it("changes only the fields sent, with updated_at from the clock (E11)", async () => {
    const { userId, keys } = await student(2);
    const exam = await createExam(userId, { exam_date: "2026-12-03", topic_keys: keys }, deps());
    const later = new Date(NOW.getTime() + 3_600_000);
    const updated = await updateExam(userId, exam.id, { target_retention: 0.95 }, deps(later));
    expect(updated).toMatchObject({
      exam_date: "2026-12-03",
      topic_keys: keys,
      target_retention: 0.95,
    });
    const row = await db.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(row.updatedAt).toEqual(later);
    expect(row.createdAt).toEqual(NOW);

    const moved = await updateExam(
      userId,
      exam.id,
      { exam_date: "2026-12-10", topic_keys: [keys[1]] },
      deps(),
    );
    expect(moved).toMatchObject({
      exam_date: "2026-12-10",
      topic_keys: [keys[1]],
      target_retention: 0.95,
    });
  });

  it("refuses a past date, a bad target, an empty patch, and someone else's exam", async () => {
    const { userId, keys } = await student(1);
    const exam = await createExam(userId, { exam_date: "2026-12-03", topic_keys: keys }, deps());
    expect(
      (await refused(updateExam(userId, exam.id, { exam_date: "2026-11-01" }, deps()))).code,
    ).toBe("invalid_date");
    expect((await refused(updateExam(userId, exam.id, { target_retention: 1 }, deps()))).code).toBe(
      "invalid_target",
    );
    expect((await refused(updateExam(userId, exam.id, {}, deps()))).code).toBe("invalid_request");
    expect((await refused(updateExam(userId, exam.id, { topic_keys: [] }, deps()))).code).toBe(
      "empty_scope",
    );
    const stranger = await seedUser(db);
    expect(
      (await refused(updateExam(stranger, exam.id, { target_retention: 0.95 }, deps()))).code,
    ).toBe("not_found");
    expect((await db.exam.findUniqueOrThrow({ where: { id: exam.id } })).targetRetention).toBe(0.9);
  });

  it("deletes the user's own exam only", async () => {
    const { userId, keys } = await student(1);
    const exam = await createExam(userId, { exam_date: "2026-12-03", topic_keys: keys }, deps());
    const stranger = await seedUser(db);
    expect((await refused(deleteExam(stranger, exam.id, deps()))).code).toBe("not_found");
    await deleteExam(userId, exam.id, deps());
    expect((await refused(deleteExam(userId, exam.id, deps()))).code).toBe("not_found");
    expect((await refused(deleteExam(userId, "nope", deps()))).code).toBe("not_found");
  });
});

describe("activeExams (07 §4.3, EM-7)", () => {
  it("returns exams after now, with exam_at at local midnight; today's and past ones are inactive", async () => {
    const { userId, sourceIds } = await student(1);
    const upcoming = await seedExam(db, userId, {
      examDate: "2026-11-25",
      sourceIds,
      target: 0.95,
    });
    await seedExam(db, userId, { examDate: "2026-11-19", sourceIds });
    await seedExam(db, userId, { examDate: "2026-11-01", sourceIds });
    const exams = await activeExams(db, userId, NOW, "Asia/Kolkata");
    expect(exams).toEqual([
      {
        id: upcoming,
        examAt: new Date("2026-11-24T18:30:00.000Z"),
        examDate: "2026-11-25",
        target: 0.95,
        scope: new Set([`src:${sourceIds[0]}`]),
      },
    ]);
  });
});

describe("examScopeOptions (ER5.1)", () => {
  it("lists the user's notes newest first with their live, servable question counts", async () => {
    const userId = await seedUser(db);
    const { sourceIds, itemIds } = await seedMcqs(db, userId, 3, { sources: 1 });
    await db.item.update({ where: { id: itemIds[0] }, data: { retiredAt: NOW } });
    await seedItem(db, userId, "cloze");
    const options = await examScopeOptions(userId, deps());
    expect(options).toHaveLength(2);
    expect(options.find((option) => option.key === `src:${sourceIds[0]}`)).toEqual({
      key: `src:${sourceIds[0]}`,
      title: "Note 1",
      items: 2,
    });
    expect(options.find((option) => option.title === "Notes")?.items).toBe(0);
    expect(await examScopeOptions(await seedUser(db), deps())).toEqual([]);
  });
});
