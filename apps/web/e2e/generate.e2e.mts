import { randomUUID } from "node:crypto";
import { test as base, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { createDb } from "@repo/db";

// "Generate questions" in the browser, with the network faked: the POST answers 202 and the
// /events socket is played by the test, so no RabbitMQ, worker or realtime is needed (the CI e2e
// job has none). The real route is covered by lib/generate-questions.test.ts and lib/jobs.int.test.ts.

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

/** Plays realtime: every /events socket the page opens, newest last. */
async function fakeRealtime(page: Page) {
  const sockets: WebSocketRoute[] = [];
  // Not connecting to a server mocks the socket: it opens at once and only the test talks on it.
  await page.routeWebSocket(/\/events\?token=/, (ws) => {
    sockets.push(ws);
  });
  return {
    /** Waits until the page has opened `count` sockets in all (a reload opens another). */
    opened: (count: number) => expect.poll(() => sockets.length).toBeGreaterThanOrEqual(count),
    /** Sends `event` on the newest socket, as realtime forwards it. */
    send: async (event: unknown) => {
      await expect.poll(() => sockets.length).toBeGreaterThan(0);
      sockets.at(-1)?.send(JSON.stringify(event));
    },
  };
}

/** The POST answers `status` without reaching the server; returns how many clicks reached it. */
async function fakeQueue(page: Page, status = 202) {
  const requests: string[] = [];
  await page.route("**/api/documents/*/questions", async (route) => {
    requests.push(route.request().method());
    await route.fulfill(
      status === 202
        ? { status, json: { status: "queued" } }
        : {
            status,
            json: {
              error: "queue_unavailable",
              message: "Couldn't start generating questions. Try again in a moment.",
            },
          },
    );
  });
  return requests;
}

/** Creates a note with some text and returns its source id, which the events name. */
async function newNote(page: Page): Promise<string> {
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop();
  const editor = page.getByRole("textbox", { name: "Note" });
  await editor.click();
  await editor.pressSequentially("Mitochondria make most of the cell's ATP.");
  const source = await db.source.findUniqueOrThrow({ where: { documentId: id } });
  return source.id;
}

const completed = (sourceId: string, payload: Record<string, unknown> = {}) => ({
  type: "ingest.completed",
  payload: {
    source_id: sourceId,
    items_created: 3,
    chunks: 3,
    chunks_pending: 0,
    budget_exhausted: false,
    ...payload,
  },
});

const generateButton = (page: Page) => page.getByRole("button", { name: /Generat/ });

test("a click waits for this note's event, and shows what it made", async ({ page, studentId }) => {
  const realtime = await fakeRealtime(page);
  const clicks = await fakeQueue(page);
  const sourceId = await newNote(page);

  await generateButton(page).click();
  await expect(page.getByRole("button", { name: "Generating questions…" })).toBeDisabled();
  await expect.poll(() => clicks).toEqual(["POST"]);
  // The autosave was flushed first, so the worker reads the text on screen.
  await expect
    .poll(
      async () => (await db.document.findFirstOrThrow({ where: { ownerId: studentId } })).contentMd,
    )
    .toContain("Mitochondria make most of the cell's ATP.");

  // Another note's result is not this one's.
  await realtime.send(completed(randomUUID(), { items_created: 9 }));
  await page.waitForTimeout(300);
  await expect(page.getByRole("button", { name: "Generating questions…" })).toBeVisible();
  await expect(page.getByText(/Made 9/)).toHaveCount(0);

  await realtime.send(completed(sourceId));
  await expect(page.getByText("Made 3 new questions.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Review them" })).toHaveAttribute("href", "/review");
  await expect(page.getByRole("button", { name: "Generate questions" })).toBeEnabled();
});

test("a long run says so after a minute, and a late event still lands", async ({
  page,
  studentId,
}) => {
  void studentId; // the fixture is what signs the page in
  await page.clock.install();
  const realtime = await fakeRealtime(page);
  await fakeQueue(page);
  const sourceId = await newNote(page);

  await generateButton(page).click();
  await expect(page.getByRole("button", { name: "Generating questions…" })).toBeDisabled();
  // The 60 s timer starts once the 202 is read, so jump again until it has fired.
  await expect(async () => {
    await page.clock.fastForward(61_000);
    await expect(page.getByText(/This is taking longer than usual\./)).toBeVisible({
      timeout: 500,
    });
  }).toPass();
  await expect(page.getByRole("button", { name: "Generate questions" })).toBeEnabled();

  await realtime.send(
    completed(sourceId, {
      items_created: 20,
      chunks: 45,
      chunks_pending: 25,
      budget_exhausted: true,
    }),
  );
  await expect(page.getByText("Made 20 new questions.")).toBeVisible();
  await expect(
    page.getByText("Today's limit is reached; 25 passages will get questions tomorrow."),
  ).toBeVisible();
});

test("a failed job and an unreachable queue each say so", async ({ page, studentId }) => {
  void studentId; // the fixture is what signs the page in
  const realtime = await fakeRealtime(page);
  const clicks = await fakeQueue(page);
  const sourceId = await newNote(page);

  await generateButton(page).click();
  // Events count only once the click has left: before that the page is still saving the note.
  await expect.poll(() => clicks).toEqual(["POST"]);
  await realtime.send({
    type: "ingest.failed",
    payload: {
      source_id: sourceId,
      error: "Questions could not be generated from this source. Try again later.",
    },
  });
  // Not getByRole("alert") alone: Next's route announcer is an alert too.
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Questions could not be generated from this source. Try again later." }),
  ).toBeVisible();

  await page.unroute("**/api/documents/*/questions");
  await fakeQueue(page, 503);
  await generateButton(page).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Couldn't start generating questions. Try again in a moment." }),
  ).toBeVisible();
});

test("a reload while generating starts idle, and ignores the old click's event", async ({
  page,
  studentId,
}) => {
  void studentId; // the fixture is what signs the page in
  const realtime = await fakeRealtime(page);
  await fakeQueue(page);
  const sourceId = await newNote(page);

  await generateButton(page).click();
  await expect(page.getByRole("button", { name: "Generating questions…" })).toBeVisible();
  await realtime.opened(1);
  await page.reload();

  await expect(page.getByRole("button", { name: "Generate questions" })).toBeEnabled();
  await realtime.opened(2);
  await realtime.send(completed(sourceId));
  await page.waitForTimeout(300);
  await expect(page.getByText("Made 3 new questions.")).toHaveCount(0);
});
