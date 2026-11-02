import type { JSONContent } from "@tiptap/react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/db";
import { getDocument } from "@/lib/documents";
import { requireUser } from "@/lib/session";
import { NoteEditor } from "./note-editor";
import { NoteHeader } from "./note-header";

export const metadata: Metadata = { title: "Note · Retently" };

export default function NotePage({ params }: PageProps<"/notes/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <Link
        href="/notes"
        className="text-muted-foreground self-start text-sm underline underline-offset-4"
      >
        All notes
      </Link>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading your note…</p>}>
        <Note params={params} />
      </Suspense>
    </main>
  );
}

async function Note({ params }: Pick<PageProps<"/notes/[id]">, "params">) {
  const user = await requireUser();
  const { id } = await params;
  const note = await getDocument(getDb(), user.id, id);
  // Someone else's note looks exactly like a missing one.
  if (!note) notFound();

  return (
    <div className="flex flex-col gap-6">
      <NoteHeader id={note.id} title={note.title} />
      <NoteEditor
        documentId={note.id}
        // Written only by this editor, so it is TipTap JSON (or null before the first save).
        initialContent={note.contentJson as JSONContent | null}
        initialVersion={note.version}
      />
    </div>
  );
}
