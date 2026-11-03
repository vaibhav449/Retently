import {
  type DocumentVersionConflict,
  type RenameDocumentResponse,
  type SaveDocumentContentResponse,
  updateDocumentRequestSchema,
} from "@repo/contracts";
import { getDb } from "@/lib/db";
import { deleteDocument, renameDocument, saveDocumentContent } from "@/lib/documents";
import { getSession } from "@/lib/session";

// Someone else's note answers 404, the same as a missing one, so ids cannot be probed.
const NOT_FOUND = { error: "not_found", message: "No such note" };

/** Two Markdown limits' worth of characters covers the JSON and the Markdown of one save. */
const MAX_BODY_CHARS = 1_000_000;

/** Renames a note (`{ title }`) or autosaves its content (`{ content_json, content_md, base_version }`). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to edit notes" }, { status: 401 });
  }

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) {
    return Response.json(
      { error: "too_large", message: "This note is too long to save" },
      { status: 413 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json(
      { error: "invalid_request", message: "The body is not JSON" },
      { status: 400 },
    );
  }
  const parsed = updateDocumentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", message: "Send a title of 1 to 200 characters, or content" },
      { status: 400 },
    );
  }

  const { id } = await ctx.params;
  const db = getDb();
  const userId = session.user.id;

  if ("title" in parsed.data) {
    const { title } = parsed.data;
    if (!(await renameDocument(db, userId, id, title))) {
      return Response.json(NOT_FOUND, { status: 404 });
    }
    return Response.json({ id, title } satisfies RenameDocumentResponse);
  }

  const result = await saveDocumentContent(db, userId, id, {
    json: parsed.data.content_json,
    markdown: parsed.data.content_md,
    baseVersion: parsed.data.base_version,
  });
  switch (result.status) {
    case "not_found":
      return Response.json(NOT_FOUND, { status: 404 });
    case "conflict":
      return Response.json(
        { error: "version_conflict", version: result.version } satisfies DocumentVersionConflict,
        { status: 409 },
      );
    case "saved":
      return Response.json({ id, version: result.version } satisfies SaveDocumentContentResponse);
  }
}

/** Deletes a note, with the questions generated from it. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to delete notes" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!(await deleteDocument(getDb(), session.user.id, id))) {
    return Response.json(NOT_FOUND, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
