import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { createDb } from "@repo/db";
import { NOTE_TEXT, seedMcq } from "./seed";

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
  await expect(page.getByText(/^Next review tomorrow/)).toBeVisible();

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
  await expect(page.getByText("Nothing to review right now")).toBeVisible();
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
