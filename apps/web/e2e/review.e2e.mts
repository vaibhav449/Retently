import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { createDb } from "@repo/db";
import { NOTE_TEXT, type SeededMcq, seedMcq } from "./seed";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set (apps/web/.env.local, or the CI job)");
const { db, close } = createDb(databaseUrl);

/** A new student, signed in on `page`, and deleted afterwards with everything they own. */
const test = base.extend<{ studentId: string }>({
  studentId: async ({ page, baseURL }, provide) => {
    const studentId = await signUp(page, baseURL);
    await provide(studentId);
    await db.user.delete({ where: { id: studentId } });
  },
});

test.afterAll(close);

/** Signs up through the API, which also sets the session cookie on the page. */
async function signUp(page: Page, origin: string | undefined): Promise<string> {
  const response = await page.request.post("/api/auth/sign-up/email", {
    // A browser sends its origin with every POST, and Better Auth checks it.
    headers: origin ? { origin } : {},
    data: {
      name: "E2E Student",
      email: `e2e-${randomUUID()}@example.com`,
      password: randomUUID(),
      dob: "2000-01-01",
    },
  });
  await expect(response).toBeOK();
  const body = (await response.json()) as { user: { id: string } };
  return body.user.id;
}

test("a confident correct answer is recorded with its confidence and latency", async ({
  page,
  studentId,
}) => {
  const mcq = await seedMcq(db, studentId);
  await page.goto("/review");

  await expect(page.getByRole("heading", { name: mcq.prompt })).toBeVisible();
  const right = page.getByRole("button", { name: mcq.right });
  // D-14: the options are on screen from the start but locked until a confidence is picked.
  await expect(right).toBeDisabled();
  // Thinking time, which the recorded latency must include.
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: "Sure" }).click();
  await expect(page.getByRole("button", { name: "Sure", pressed: true })).toBeVisible();
  await right.click();

  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
  await expect(page.getByText(NOTE_TEXT)).toBeVisible();
  // fsrs6-v1: a new card answered Good comes back in 3 days.
  await expect(page.getByText(/^Next review in 3 days/)).toBeVisible();

  const log = await db.reviewLog.findFirstOrThrow({ where: { userId: studentId } });
  expect(log).toMatchObject({
    itemId: mcq.itemId,
    context: "solo",
    confidence: "sure",
    correct: true,
    grade: 3,
  });
  expect(log.latencyMs).toBeGreaterThanOrEqual(1_000);
  expect(log.latencyMs).toBeLessThan(30_000);

  // Focus moved to the result, so one Tab reaches the next question.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Next question" })).toBeFocused();
  await page.keyboard.press("Enter");
  // Today's plan was that one question.
  await expect(page.getByText("Done for today")).toBeVisible();
  await expect(page.getByRole("button", { name: "Study more" })).toHaveCount(0);
});

test("a confident wrong answer shows what the notes say and is recorded as a miss", async ({
  page,
  studentId,
}) => {
  const mcq = await seedMcq(db, studentId);
  await page.goto("/review");

  await page.getByRole("button", { name: "Sure" }).click();
  await page.getByRole("button", { name: mcq.wrong }).click();

  await expect(page.getByText("Not quite", { exact: true })).toBeVisible();
  await expect(
    page.getByText(`You were sure it was “${mcq.wrong}”, but the answer is “${mcq.right}”.`),
  ).toBeVisible();
  await expect(page.getByText(NOTE_TEXT)).toBeVisible();

  const log = await db.reviewLog.findFirstOrThrow({ where: { userId: studentId } });
  expect(log).toMatchObject({ confidence: "sure", correct: false, grade: 1 });
});

const DAY_MS = 24 * 60 * 60 * 1000;
/** Asia/Kolkata is UTC+05:30 all year, with no DST. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The first IST midnight after `at`, worked out without the engine's own helper. */
function nextIstMidnight(at: Date): Date {
  const istDay = Math.floor((at.getTime() + IST_OFFSET_MS) / DAY_MS);
  return new Date((istDay + 1) * DAY_MS - IST_OFFSET_MS);
}

test("a confident wrong answer comes back at the start of the next local day", async ({
  page,
  studentId,
}) => {
  // A new student has no revision_settings row, so their day is the IST day.
  const mcq = await seedMcq(db, studentId);
  await page.goto("/review");

  await page.getByRole("button", { name: "Sure" }).click();
  await page.getByRole("button", { name: mcq.wrong }).click();
  await expect(page.getByText("Not quite", { exact: true })).toBeVisible();
  // FSRS alone could say more days; the override brings it back tomorrow.
  await expect(page.getByText(/^Next review tomorrow/)).toBeVisible();

  const log = await db.reviewLog.findFirstOrThrow({ where: { userId: studentId } });
  const card = await db.cardState.findUniqueOrThrow({
    where: { userId_itemId: { userId: studentId, itemId: mcq.itemId } },
  });
  const until = nextIstMidnight(log.reviewedAt);
  expect(card.misconceptionUntil).toEqual(until);

  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByText("Done for today")).toBeVisible();

  /** Reloads with the server's review clock shifted so that "now" is `target`. */
  async function reloadAt(target: number) {
    await page.setExtraHTTPHeaders({ "x-review-clock-offset-ms": String(target - Date.now()) });
    const next = page.waitForResponse((response) => response.url().endsWith("/api/review/next"));
    await page.reload();
    // Without REVIEW_TEST_CLOCK=1 on the dev server the offset is ignored: fail clearly.
    expect((await next).headers()["x-review-clock"], "REVIEW_TEST_CLOCK=1 on the server").toBe(
      "offset",
    );
  }

  // Still today: the plan is done, and the retest belongs to tomorrow's plan.
  await reloadAt(until.getTime() - 60_000);
  await expect(page.getByText("Done for today")).toBeVisible();

  await reloadAt(until.getTime() + 60_000);
  await expect(page.getByRole("heading", { name: mcq.prompt })).toBeVisible();
  await expect(page.getByText(/^Retest · /)).toBeVisible();
});

/** Answers the question on screen confidently and correctly, then moves on. */
async function answerRight(page: Page, mcq: SeededMcq) {
  await expect(page.getByRole("heading", { name: mcq.prompt })).toBeVisible();
  await page.getByRole("button", { name: "Sure" }).click();
  await page.getByRole("button", { name: mcq.right }).click();
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByText("Correct", { exact: true })).toBeHidden();
}

test("today's plan ends in done for today, and Study more adds new items without repeats", async ({
  page,
  studentId,
}) => {
  const planned = [await seedMcq(db, studentId), await seedMcq(db, studentId)];
  await page.goto("/review");
  // A brand-new student: a cold-start plan of both questions, with the time left.
  await expect(page.getByText(/^New · 0 of 2 done today · about 1 min left/)).toBeVisible();
  await expect(page.getByText("A new question from your notes.")).toBeVisible();

  // Generated after the plan was built: not in today's plan.
  const later = [await seedMcq(db, studentId), await seedMcq(db, studentId)];
  for (const mcq of planned) await answerRight(page, mcq);

  await expect(page.getByText("Done for today")).toBeVisible();
  const answered = async () =>
    (await db.reviewLog.findMany({ where: { userId: studentId } })).map((row) => row.itemId);
  expect((await answered()).sort()).toEqual(planned.map((mcq) => mcq.itemId).sort());

  await page.getByRole("button", { name: "Study more" }).click();
  await expect(page.getByText(/^New · 2 of 4 done today/)).toBeVisible();
  for (const mcq of later) await answerRight(page, mcq);

  await expect(page.getByText("Done for today")).toBeVisible();
  await expect(page.getByRole("button", { name: "Study more" })).toHaveCount(0);
  const all = await answered();
  expect(new Set(all).size).toBe(4);
  expect([...all].sort()).toEqual([...planned, ...later].map((mcq) => mcq.itemId).sort());

  const session = await db.reviewSession.findFirstOrThrow({ where: { userId: studentId } });
  expect(session.extendedCount).toBe(1);
});
