import { randomUUID } from "node:crypto";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { createDb } from "@repo/db";
import { seedNoteWithMcqs } from "./seed";

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

/** The student's local date `days` from now: they have no revision_settings, so Asia/Kolkata. */
function istDate(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);
}

const NOTE = "Exam note — Photosynthesis";

test("set up an exam, read its forecast, raise the target, then delete it (EA8)", async ({
  page,
  studentId,
}) => {
  // Four routes compile on their first visit in dev; the default 2 minutes is tight for that.
  test.setTimeout(300_000);
  // With cacheComponents, Next keeps visited routes mounted but hidden, so the new-exam form, say,
  // is still in the DOM on the edit page: look only at what is on screen.
  const shown = (locator: Locator) => locator.filter({ visible: true });
  await seedNoteWithMcqs(db, studentId, { title: NOTE, count: 6, reviewed: 3 });

  await page.goto("/exams");
  await expect(shown(page.getByText("No upcoming exams."))).toBeVisible();
  await shown(page.getByRole("link", { name: "Plan for an exam" })).click();

  await shown(page.getByLabel("Exam date")).fill(istDate(7));
  await shown(page.getByRole("checkbox", { name: new RegExp(NOTE) })).check();
  await expect(shown(page.getByText(/^90% is what your reviews aim for anyway/))).toBeVisible();
  await shown(page.getByRole("button", { name: "Save and see the forecast" })).click();

  // The forecast: the status sentence and the daily plan.
  await expect(page).toHaveURL(/\/exams\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const headline = shown(page.getByTestId("exam-headline"));
  await expect(headline).toHaveText(/^On track: at your pace, 6\/6 items should be at 90% on /, {
    timeout: 60_000,
  });
  const before = await headline.textContent();
  const days = shown(page.getByRole("list", { name: "Reviews per day" })).getByRole("listitem");
  await expect(days).toHaveCount(7);
  await expect(shown(page.getByText("Every review is graded Good."))).toBeVisible();

  const exam = await db.exam.findFirstOrThrow({ where: { userId: studentId } });
  expect(exam.targetRetention).toBe(0.9);

  // Raise the target: the trade-off is spelled out, and the forecast changes.
  await shown(page.getByRole("link", { name: "Edit exam" })).click();
  await expect(shown(page.getByRole("heading", { name: "Edit exam" }))).toBeVisible({
    timeout: 60_000,
  });
  await shown(page.getByLabel(/^Target recall on exam day/)).fill("0.95");
  await expect(
    shown(
      page.getByText(
        "At 95% each question needs about 2.5× the memory strength it needs at 90%, so expect far more reviews.",
      ),
    ),
  ).toBeVisible();
  await shown(page.getByRole("button", { name: "Save changes" })).click();

  await expect(page).toHaveURL(new RegExp(`/exams/${exam.id}$`), { timeout: 60_000 });
  await expect(headline).toContainText("95%", { timeout: 60_000 });
  expect(await headline.textContent()).not.toBe(before);
  await expect(shown(page.getByText(/drops below 95%/))).toBeVisible();
  expect((await db.exam.findUniqueOrThrow({ where: { id: exam.id } })).targetRetention).toBe(0.95);

  // Delete it, with the in-page confirmation.
  await shown(page.getByRole("link", { name: "All exams" })).click();
  await shown(page.getByRole("button", { name: "Delete", exact: true })).click();
  await expect(shown(page.getByText("Delete this exam?"))).toBeVisible();
  await shown(page.getByRole("button", { name: "Yes, delete" })).click();
  await expect(shown(page.getByText("No upcoming exams."))).toBeVisible();
  expect(await db.exam.count({ where: { userId: studentId } })).toBe(0);
});

test("the exam API needs a session (EA7)", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.get("/api/exams")).status()).toBe(401);
  expect((await anonymous.get(`/api/exams/${randomUUID()}/forecast`)).status()).toBe(401);
  await anonymous.dispose();
});

test("validation errors reach the caller; another student's exam is a 404 (EA6, EA7)", async ({
  page,
  studentId,
  baseURL,
}) => {
  const { topicKey } = await seedNoteWithMcqs(db, studentId, {
    title: NOTE,
    count: 1,
    reviewed: 0,
  });
  const post = (data: unknown) => page.request.post("/api/exams", { data });

  const past = await post({ exam_date: istDate(-1), topic_keys: [topicKey] });
  expect(past.status()).toBe(400);
  expect(await past.json()).toMatchObject({ error: "invalid_date", field: "exam_date" });
  const empty = await post({ exam_date: istDate(7), topic_keys: [] });
  expect(await empty.json()).toMatchObject({ error: "empty_scope" });
  const target = await post({
    exam_date: istDate(7),
    topic_keys: [topicKey],
    target_retention: 0.99,
  });
  expect(await target.json()).toMatchObject({ error: "invalid_target" });
  const unknown = await post({ exam_date: istDate(7), topic_keys: [`src:${randomUUID()}`] });
  expect(await unknown.json()).toMatchObject({ error: "unreadable_scope" });

  const created = await post({ exam_date: istDate(7), topic_keys: [topicKey] });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  // A second student, signed in on the same page.
  await page.context().clearCookies();
  const strangerId = await signUp(page, baseURL);
  try {
    expect((await page.request.get(`/api/exams/${id}/forecast`)).status()).toBe(404);
    const patch = await page.request.patch(`/api/exams/${id}`, {
      data: { target_retention: 0.95 },
    });
    expect(patch.status()).toBe(404);
    expect((await page.request.delete(`/api/exams/${id}`)).status()).toBe(404);
  } finally {
    await db.user.delete({ where: { id: strangerId } });
  }
});
