import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { createDb } from "@repo/db";

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

test("a student creates, renames and deletes a note", async ({ page, studentId }) => {
  await page.goto("/notes");
  await expect(page.getByText("No notes yet.")).toBeVisible();

  await page.getByRole("button", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop();

  // The source is created with the note, so it can be ingested later.
  const source = await db.source.findUniqueOrThrow({ where: { documentId: id } });
  expect(source).toMatchObject({ ownerId: studentId, kind: "note", title: "Untitled" });

  const title = page.getByLabel("Title");
  await title.fill("Cell biology");
  await title.press("Enter");
  await expect(page.getByText("Saving…")).toBeHidden();
  await expect
    .poll(async () => (await db.source.findUniqueOrThrow({ where: { id: source.id } })).title)
    .toBe("Cell biology");

  await page.goto("/notes");
  await expect(page.getByRole("link", { name: /Cell biology/ })).toBeVisible();
  await page.getByRole("link", { name: /Cell biology/ }).click();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByText("No notes yet.")).toBeVisible();
  expect(await db.source.count({ where: { id: source.id } })).toBe(0);
});

test("a note's text is autosaved and survives a reload", async ({ page }) => {
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop();

  const editor = page.getByRole("textbox", { name: "Note" });
  await editor.click();
  // "## " is TipTap's Markdown shortcut for a heading.
  await editor.pressSequentially("## Cells");
  await editor.press("Enter");
  await editor.pressSequentially("Mitochondria make most of the cell's ATP.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  const saved = await db.document.findUniqueOrThrow({ where: { id } });
  expect(saved.contentMd).toBe("## Cells\n\nMitochondria make most of the cell's ATP.");
  expect(saved.version).toBeGreaterThan(0);
  const blocks = (saved.contentJson as { content: { type: string; attrs: { id: string } }[] })
    .content;
  expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph"]);
  for (const block of blocks) expect(block.attrs.id).toEqual(expect.any(String));

  await page.reload();
  await expect(page.getByRole("heading", { name: "Cells" })).toBeVisible();
  await expect(editor).toContainText("Mitochondria make most of the cell's ATP.");

  // Editing again keeps the block ids that chunks will point at.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" It has two membranes.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await db.document.findUniqueOrThrow({ where: { id } })).contentMd)
    .toBe("## Cells\n\nMitochondria make most of the cell's ATP. It has two membranes.");
  const edited = await db.document.findUniqueOrThrow({ where: { id } });
  const editedBlocks = (edited.contentJson as { content: { attrs: { id: string } }[] }).content;
  expect(editedBlocks.map((block) => block.attrs.id)).toEqual(
    blocks.map((block) => block.attrs.id),
  );
});

test("a save from a stale version is refused", async ({ page, studentId }) => {
  const note = await db.document.create({
    data: {
      ownerId: studentId,
      contentMd: "Newer text from another tab",
      version: 3,
      source: { create: { ownerId: studentId, kind: "note", title: "Untitled" } },
    },
  });

  const response = await page.request.patch(`/api/documents/${note.id}`, {
    data: { content_json: { type: "doc", content: [] }, content_md: "Older text", base_version: 2 },
  });
  expect(response.status()).toBe(409);
  expect(await response.json()).toEqual({ error: "version_conflict", version: 3 });

  const after = await db.document.findUniqueOrThrow({ where: { id: note.id } });
  expect(after).toMatchObject({ contentMd: "Newer text from another tab", version: 3 });
});

test("another student's note is not found", async ({ page, browser, baseURL, studentId }) => {
  const note = await db.document.create({
    data: {
      ownerId: studentId,
      title: "Private",
      source: { create: { ownerId: studentId, kind: "note", title: "Private" } },
    },
  });

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  const otherId = await signUp(other, baseURL);
  try {
    await other.goto(`/notes/${note.id}`);
    await expect(other.getByRole("heading", { name: "Note not found" })).toBeVisible();
    await expect(other.getByText("Private")).toBeHidden();

    const rename = await other.request.patch(`/api/documents/${note.id}`, {
      data: { title: "Taken" },
    });
    expect(rename.status()).toBe(404);
    const save = await other.request.patch(`/api/documents/${note.id}`, {
      data: { content_json: { type: "doc", content: [] }, content_md: "Taken", base_version: 0 },
    });
    expect(save.status()).toBe(404);
    const remove = await other.request.delete(`/api/documents/${note.id}`);
    expect(remove.status()).toBe(404);

    // Nothing changed for the owner.
    const after = await db.document.findUniqueOrThrow({ where: { id: note.id } });
    expect(after.title).toBe("Private");
    await page.goto("/notes");
    await expect(page.getByRole("link", { name: /Private/ })).toBeVisible();
  } finally {
    await otherContext.close();
    await db.user.delete({ where: { id: otherId } });
  }
});
