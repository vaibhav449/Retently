import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type Database, realUsers, syntheticUsers } from "@repo/db";
import {
  checkCardState,
  createDefaultRegistry,
  DEFAULT_EXAM,
  DEFAULT_GRADING,
  DEFAULT_QUEUE,
  effectiveDueAt,
  forecastFor,
  getOrCreateSession,
  latencyMediansFromDb,
  listExams,
  localDateOf,
  nextInSession,
  recordReview,
  type RecordReviewInput,
  startOfNextLocalDay,
} from "@repo/revision";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { snapshot } from "../test/snapshot";
import { DEFAULT_SYNTH } from "./config";
import { deleteSyntheticUsers } from "./reset";
import { seedCohort, type SeedSummary } from "./seed";

// Every engine entry point the generator uses, wrapped so the test can see each call go through
// the real package (REQ "Ran the real engine"). The originals still do all the work.
vi.mock("@repo/revision", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/revision")>();
  return {
    ...actual,
    recordReview: vi.fn(actual.recordReview),
    getOrCreateSession: vi.fn(actual.getOrCreateSession),
    nextInSession: vi.fn(actual.nextInSession),
  };
});

const { db, close } = createDb(inject("databaseUrl"));
const registry = createDefaultRegistry();
const tz = DEFAULT_SYNTH.timeZone;

/** 12:00 IST on 2026-11-25: the fixed "now" of both runs. */
const END = new Date("2026-11-25T06:30:00.000Z");
const COHORT = { seed: "int-test", students: 3, days: 14, end: END, demo: true } as const;

/** A real user with a note, a question and one review: the generator must never touch them. */
async function seedRealUser(database: Database): Promise<void> {
  const userId = `user_${randomUUID()}`;
  await database.user.create({
    data: { id: userId, name: "Real", email: `${userId}@example.com`, dob: new Date("2000-01-01") },
  });
  const source = await database.source.create({
    data: { ownerId: userId, kind: "note", title: "A real note" },
  });
  const chunk = await database.chunk.create({
    data: { sourceId: source.id, blockIds: ["blk_1"], text: "Real text.", contentHash: "real" },
  });
  const [right, wrong] = [randomUUID(), randomUUID()];
  const item = await database.item.create({
    data: {
      sourceChunkId: chunk.id,
      type: "mcq",
      prompt: "A real question?",
      answer: "Yes",
      options: [
        { id: right, text: "Yes" },
        { id: wrong, text: "No" },
      ],
      answerOptionId: right,
    },
  });
  await recordReview(
    {
      reviewId: randomUUID(),
      userId,
      itemId: item.id,
      context: "solo",
      confidence: "sure",
      response: { kind: "mcq", option_id: wrong },
      latencyMs: 4_000,
    },
    {
      db: database,
      clock: { now: () => new Date("2026-11-20T10:00:00Z") },
      registry,
      grading: DEFAULT_GRADING,
    },
  );
}

/** Everything real users own, to show it is untouched. */
async function realRows(database: Database) {
  const user = realUsers();
  return JSON.stringify(
    await Promise.all([
      database.user.findMany({ where: user, orderBy: { id: "asc" } }),
      database.source.findMany({ where: { owner: user }, orderBy: { id: "asc" } }),
      database.chunk.findMany({ where: { source: { owner: user } }, orderBy: { id: "asc" } }),
      database.item.findMany({
        where: { sourceChunk: { source: { owner: user } } },
        orderBy: { id: "asc" },
      }),
      database.reviewLog.findMany({ where: { user }, orderBy: { id: "asc" } }),
      database.cardState.findMany({ where: { user }, orderBy: { itemId: "asc" } }),
    ]),
  );
}

async function syntheticCounts(database: Database) {
  const owned = { user: syntheticUsers() };
  return {
    users: await database.user.count({ where: syntheticUsers() }),
    items: await database.item.count({
      where: { sourceChunk: { source: { owner: syntheticUsers() } } },
    }),
    reviews: await database.reviewLog.count({ where: owned }),
    sessions: await database.reviewSession.count({ where: owned }),
    exams: await database.exam.count({ where: owned }),
  };
}

const tsxCli = fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url));
const seedCli = fileURLToPath(new URL("./cli.ts", import.meta.url));

/** `npm run db:seed -- <args>` as a child process, with these variables set. */
function runCli(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, [tsxCli, seedCli, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 120_000,
  });
}

let dir: string;
let first: SeedSummary;
let second: SeedSummary;
let firstSnapshot: Awaited<ReturnType<typeof snapshot>>;
let secondSnapshot: Awaited<ReturnType<typeof snapshot>>;
let realBefore: string;
let recorded: RecordReviewInput[];
let sessionBuilds: number;
let nextCalls: number;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "synth-"));
  await seedRealUser(db);
  realBefore = await realRows(db);

  first = await seedCohort({ db, ...COHORT, truthPath: join(dir, "first.jsonl") });
  firstSnapshot = await snapshot(db);

  vi.mocked(recordReview).mockClear();
  vi.mocked(getOrCreateSession).mockClear();
  vi.mocked(nextInSession).mockClear();
  second = await seedCohort({ db, ...COHORT, truthPath: join(dir, "second.jsonl") });
  secondSnapshot = await snapshot(db);
  recorded = vi.mocked(recordReview).mock.calls.map(([input]) => input);
  sessionBuilds = vi.mocked(getOrCreateSession).mock.calls.length;
  // Read here: Vitest clears mock state between the hook and the tests.
  nextCalls = vi.mocked(nextInSession).mock.calls.length;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await close();
});

describe("the generator drives the real engine", () => {
  it("records every answer through recordReview() and builds every session with the engine", async () => {
    const reviews = await db.reviewLog.findMany({
      where: { user: syntheticUsers() },
      select: { id: true },
    });
    expect(reviews.length).toBeGreaterThan(100);
    expect(recorded).toHaveLength(reviews.length);
    expect(new Set(recorded.map((input) => input.reviewId))).toEqual(
      new Set(reviews.map((review) => review.id)),
    );
    expect(recorded.every((input) => input.context === "solo")).toBe(true);

    const sessions = await db.reviewSession.count({ where: { user: syntheticUsers() } });
    expect(sessionBuilds).toBe(sessions);
    // Every answer was taken from the engine's plan: one nextInSession() per answer at least.
    expect(nextCalls).toBeGreaterThanOrEqual(reviews.length);
  });

  it("makes no LLM call", async () => {
    expect(await db.llmUsage.count()).toBe(0);
  });

  it("writes only fsrs6-v1 rows in the simulated past", async () => {
    const versions = await db.reviewLog.groupBy({
      by: ["schedulerVersion"],
      where: { user: syntheticUsers() },
      _count: true,
    });
    expect(versions.map((v) => v.schedulerVersion)).toEqual(["fsrs6-v1"]);
  });
});

describe("V6: replay equivalence", () => {
  it("engine:check finds no mismatch, misconception_until included (I2, I4)", async () => {
    expect(await checkCardState({ db, registry })).toEqual([]);
  });
});

describe("V7: determinism", () => {
  it("gives identical rows for the same seed and end", () => {
    expect(secondSnapshot.reviews.length).toBe(firstSnapshot.reviews.length);
    expect(secondSnapshot).toEqual(firstSnapshot);
  });

  it("writes an identical truth sidecar", async () => {
    const [a, b] = await Promise.all([
      readFile(join(dir, "first.jsonl"), "utf8"),
      readFile(join(dir, "second.jsonl"), "utf8"),
    ]);
    expect(b).toBe(a);
    expect(second.truth).toEqual(first.truth);
  });

  it("replaces the cohort instead of duplicating it", async () => {
    expect(second.removed).toBe(COHORT.students);
    expect((await syntheticCounts(db)).users).toBe(COHORT.students);
  });

  it("never touches a real user", async () => {
    expect(await realRows(db)).toBe(realBefore);
  });
});

describe("the truth sidecar", () => {
  it("has one run line, one line per student and one per review, matching the database", async () => {
    const lines = second.truth.map((line) => JSON.parse(line) as Record<string, unknown>);
    const kinds = (kind: string) => lines.filter((line) => line.kind === kind);
    expect(kinds("run")).toHaveLength(1);
    expect(kinds("student")).toHaveLength(COHORT.students);
    const reviews = await db.reviewLog.findMany({
      where: { user: syntheticUsers() },
      select: { id: true },
    });
    expect(kinds("review")).toHaveLength(reviews.length);
    expect(new Set(kinds("review").map((line) => line.review_id))).toEqual(
      new Set(reviews.map((review) => review.id)),
    );
    for (const line of kinds("review")) {
      expect(line.r_true).toBeGreaterThanOrEqual(0);
      expect(line.r_true).toBeLessThanOrEqual(1);
      expect(typeof line.misconceived).toBe("boolean");
    }
    const users = new Set(kinds("student").map((line) => line.email));
    expect([...users].every((email) => String(email).endsWith("@synthetic.invalid"))).toBe(true);
  });
});

describe("statistical shape (3 students × 14 days, seed int-test; loose bounds)", () => {
  const all = () => second.runs.flatMap((run) => run.reviews);

  it("has a plausible accuracy, not near 0 or 1", () => {
    const accuracy = all().filter((r) => r.correct).length / all().length;
    expect(accuracy).toBeGreaterThan(0.45);
    expect(accuracy).toBeLessThan(0.95);
  });

  it("shows more Sure from the over-confident student than the under-confident one", () => {
    const sureShare = (group: string) => {
      const run = second.runs.find((r) => r.student.biasGroup === group);
      if (run === undefined) throw new Error(`no ${group} student`);
      return run.reviews.filter((r) => r.confidence === "sure").length / run.reviews.length;
    };
    expect(sureShare("over")).toBeGreaterThan(sureShare("under") + 0.05);
  });

  it("has Sure + wrong at first exposures, most of which recover later", () => {
    const firstMistakes = all().filter(
      (r) => r.firstExposure && r.confidence === "sure" && !r.correct,
    );
    expect(firstMistakes.length).toBeGreaterThan(0);
    const later = firstMistakes
      .map((mistake) =>
        all().filter((r) => r.itemId === mistake.itemId && r.reviewedAt > mistake.reviewedAt),
      )
      .filter((reviews) => reviews.length > 0);
    expect(later.length).toBeGreaterThan(0);
    const recovered = later.filter((reviews) => reviews.at(-1)?.correct === true).length;
    expect(recovered / later.length).toBeGreaterThan(0.5);
  });

  it("produces both Easy and Again", async () => {
    const grades = await db.reviewLog.groupBy({
      by: ["grade"],
      where: { user: syntheticUsers() },
      _count: true,
    });
    const seen = new Set(grades.map((g) => g.grade));
    expect(seen.has(1)).toBe(true);
    expect(seen.has(4)).toBe(true);
  });

  it("has sessions roughly as often as each student's adherence", () => {
    // Active days are Binomial(days, q): within 3.5 standard deviations, not a flat share, so
    // the check tests the mechanism without asking 14 days to be lucky.
    for (const run of second.runs) {
      const q = run.student.adherence;
      const sd = Math.sqrt(COHORT.days * q * (1 - q));
      expect(Math.abs(run.sessions - COHORT.days * q), run.student.email).toBeLessThan(3.5 * sd);
    }
    const expected = second.runs.reduce((sum, run) => sum + COHORT.days * run.student.adherence, 0);
    expect(Math.abs(second.sessions - expected) / expected).toBeLessThan(0.3);
  });

  it("has reviews on most days a student was active", () => {
    for (const run of second.runs) {
      const days = new Set(run.reviews.map((r) => localDateOf(new Date(r.reviewedAt), tz)));
      expect(days.size / run.activeDates.length).toBeGreaterThanOrEqual(0.8);
    }
  });
});

describe("time is honest", () => {
  it("released the end day's questions by the end, and nothing later", async () => {
    const latest = await db.item.aggregate({
      where: { sourceChunk: { source: { owner: syntheticUsers() } } },
      _max: { createdAt: true },
    });
    expect(latest._max.createdAt?.getTime()).toBeLessThanOrEqual(END.getTime());
    expect(localDateOf(latest._max.createdAt ?? new Date(0), tz)).toBe(second.endDate);
  });

  it("has no review after the end, none before its item existed", async () => {
    const reviews = await db.reviewLog.findMany({
      where: { user: syntheticUsers() },
      select: { reviewedAt: true, item: { select: { createdAt: true } } },
    });
    for (const review of reviews) {
      expect(review.reviewedAt.getTime()).toBeLessThanOrEqual(END.getTime());
      expect(review.reviewedAt.getTime()).toBeGreaterThanOrEqual(review.item.createdAt.getTime());
    }
  });

  it("puts every review inside its day's session, after the session was built", async () => {
    const [reviews, sessions] = await Promise.all([
      db.reviewLog.findMany({
        where: { user: syntheticUsers() },
        select: { userId: true, reviewedAt: true },
      }),
      db.reviewSession.findMany({
        where: { user: syntheticUsers() },
        select: { userId: true, localDate: true, createdAt: true },
      }),
    ]);
    const sessionOf = new Map(
      sessions.map((s) => [`${s.userId}:${s.localDate.toISOString().slice(0, 10)}`, s]),
    );
    for (const review of reviews) {
      const session = sessionOf.get(`${review.userId}:${localDateOf(review.reviewedAt, tz)}`);
      expect(session).toBeDefined();
      expect(review.reviewedAt.getTime()).toBeGreaterThanOrEqual(session?.createdAt.getTime() ?? 0);
      expect(review.reviewedAt.getTime()).toBeLessThan(
        startOfNextLocalDay(session?.createdAt ?? new Date(0), tz).getTime(),
      );
      expect(session?.createdAt.getTime()).toBeLessThan(END.getTime());
    }
  });

  it("leaves cards due at the end, and a real session for each student on the end day", async () => {
    const cards = await db.cardState.findMany({
      where: { user: syntheticUsers() },
      select: { dueAt: true, misconceptionUntil: true },
    });
    expect(cards.some((card) => effectiveDueAt(card).getTime() <= END.getTime())).toBe(true);
    // Opening /review at the end: the engine plans something for every student today.
    const deps = { db, clock: { now: () => END }, registry, grading: DEFAULT_GRADING };
    for (const run of second.runs) {
      const today = await getOrCreateSession(run.student.id, { ...deps, queue: DEFAULT_QUEUE });
      expect(today.session.localDate).toBe(second.endDate);
      expect(today.session.plan.length, run.student.email).toBeGreaterThan(0);
    }
  });

  it("gives exam countdowns that match the end", async () => {
    const clock = { now: () => END };
    for (const run of second.runs.filter((r) => r.exam !== null)) {
      const { exams } = await listExams(
        run.student.id,
        {},
        { db, clock, exam: DEFAULT_EXAM, queue: DEFAULT_QUEUE },
      );
      expect(exams).toHaveLength(1);
      expect(exams[0]?.days_left).toBe(run.exam?.daysAfterEnd);
      expect(exams[0]?.status).toBe("upcoming");
    }
  });
});

describe("exam integration", () => {
  const withExam = () => second.runs.filter((run) => run.exam !== null);

  it("has a student whose session plans carry exam-weighted entries", async () => {
    expect(withExam().length).toBeGreaterThan(0);
    let weighted = 0;
    for (const run of withExam()) {
      const sessions = await db.reviewSession.findMany({
        where: { userId: run.student.id },
        select: { plan: true },
      });
      for (const session of sessions) {
        const plan = session.plan as { features: { exam: number }; exam_ref?: unknown }[];
        weighted += plan.filter((entry) => entry.features.exam > 0 && entry.exam_ref).length;
      }
    }
    expect(weighted).toBeGreaterThan(0);
  });

  it("gives each exam a real forecast", async () => {
    for (const run of withExam()) {
      const forecast = await forecastFor(run.student.id, run.exam?.id ?? "", {
        db,
        clock: { now: () => END },
        registry,
        queue: DEFAULT_QUEUE,
        exam: DEFAULT_EXAM,
        medians: latencyMediansFromDb(db, DEFAULT_GRADING.latency),
      });
      expect(forecast.status).not.toBe("no_items");
      expect(forecast.items.total).toBeGreaterThan(0);
      expect(forecast.exam.days_left).toBe(run.exam?.daysAfterEnd);
    }
  });
});

describe("safety", () => {
  it("refuses a database that is not on this machine before writing anything", async () => {
    const before = await syntheticCounts(db);
    const result = runCli(["--quick"], {
      DATABASE_URL: "postgres://app:app@db.example.com:5432/app",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("refusing to seed db.example.com");
    expect(result.stdout).not.toContain("Seeding");
    expect(await syntheticCounts(db)).toEqual(before);
  });

  it("refuses the demo sign-in in production before writing anything", async () => {
    const before = await syntheticCounts(db);
    const result = runCli(["--quick"], {
      DATABASE_URL: inject("databaseUrl"),
      NODE_ENV: "production",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--no-demo");
    expect(await syntheticCounts(db)).toEqual(before);
  });

  // Last: it empties the cohort the other tests read.
  it("--reset removes every synthetic row and nothing else", async () => {
    const result = runCli(["--reset"], { DATABASE_URL: inject("databaseUrl") });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Removed ${COHORT.students} synthetic users.`);
    expect(await syntheticCounts(db)).toEqual({
      users: 0,
      items: 0,
      reviews: 0,
      sessions: 0,
      exams: 0,
    });
    expect(await db.account.count({ where: { user: syntheticUsers() } })).toBe(0);
    expect(await realRows(db)).toBe(realBefore);
    expect(await deleteSyntheticUsers(db)).toBe(0);
  });
});
