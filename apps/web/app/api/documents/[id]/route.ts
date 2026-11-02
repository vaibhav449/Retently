import { type RenameDocumentResponse, renameDocumentRequestSchema } from "@repo/contracts";
import { getDb } from "@/lib/db";
import { deleteDocument, renameDocument } from "@/lib/documents";
import { getSession } from "@/lib/session";

// Someone else's note answers 404, the same as a missing one, so ids cannot be probed.
const NOT_FOUND = { error: "not_found", message: "No such note" };

/** Renames a note. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to edit notes" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_request", message: "The body is not JSON" },
      { status: 400 },
    );
  }
  const parsed = renameDocumentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", message: "A title needs 1 to 200 characters" },
      { status: 400 },
    );
  }

  const { id } = await ctx.params;
  const { title } = parsed.data;
  if (!(await renameDocument(getDb(), session.user.id, id, title))) {
    return Response.json(NOT_FOUND, { status: 404 });
  }
  return Response.json({ id, title } satisfies RenameDocumentResponse);
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
