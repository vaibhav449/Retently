import type { CreateDocumentResponse } from "@repo/contracts";
import { getDb } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { getSession } from "@/lib/session";

/** Creates an empty note for the signed-in user. */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to create notes" }, { status: 401 });
  }

  const { id } = await createDocument(getDb(), session.user.id);
  return Response.json({ id } satisfies CreateDocumentResponse, { status: 201 });
}
