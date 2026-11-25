import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type Locator, test } from "@playwright/test";
import { createDb } from "@repo/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set (apps/web/.env.local, or the CI job)");
const { db, close } = createDb(databaseUrl);

/** The documented demo credential (eval/README.md), created by `npm run db:seed`. */
const DEMO = { email: "demo@synthetic.invalid", password: "synthetic-demo" };
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

test.afterAll(close);

// CI seeds the quick cohort before this job's tests; locally, seed it here if it is missing.
test.beforeAll(async () => {
  test.setTimeout(180_000);
  const demo = await db.user.findUnique({ where: { email: DEMO.email } });
  if (demo === null) {
    execSync("npm run db:seed -- --quick", {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  }
});

test("the demo student signs in and sees a real session and an exam forecast", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(300_000);
  // With cacheComponents, Next keeps visited routes mounted but hidden: look only at the screen.
  const shown = (locator: Locator) => locator.filter({ visible: true });

  const response = await page.request.post("/api/auth/sign-in/email", {
    headers: baseURL ? { origin: baseURL } : {},
    data: DEMO,
  });
  await expect(response).toBeOK();

  // /review: today's plan, built from weeks of synthetic history, serves a question.
  await page.goto("/review");
  await expect(shown(page.getByRole("button", { name: "Sure" }))).toBeVisible({ timeout: 60_000 });
  await expect(shown(page.getByText("Done for today"))).toHaveCount(0);
  await expect(shown(page.getByText("Nothing to review right now"))).toHaveCount(0);

  // /exams: the exam the demo student set up during the simulation, with a forecast.
  const exam = await db.exam.findFirstOrThrow({ where: { user: { email: DEMO.email } } });
  await page.goto("/exams");
  const link = shown(page.locator(`a[href="/exams/${exam.id}"]`)).first();
  await expect(link).toBeVisible({ timeout: 60_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/exams/${exam.id}$`), { timeout: 60_000 });
  await expect(shown(page.getByTestId("exam-headline"))).toHaveText(
    /^(On track|Tight|Behind|Not enough time):/,
    { timeout: 60_000 },
  );
});
