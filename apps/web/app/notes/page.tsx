import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/lib/db";
import { listDocuments } from "@/lib/documents";
import { requireUser } from "@/lib/session";
import { NewNoteButton } from "./new-note-button";

export const metadata: Metadata = { title: "Notes · Retently" };

const editedAt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export default function NotesPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Notes</h1>
        <Link href="/" className="text-muted-foreground text-sm underline underline-offset-4">
          Home
        </Link>
      </div>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading your notes…</p>}>
        <NoteList />
      </Suspense>
    </main>
  );
}

async function NoteList() {
  const user = await requireUser();
  const notes = await listDocuments(getDb(), user.id);

  return (
    <div className="flex flex-col gap-4">
      <NewNoteButton />
      {notes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No notes yet. Write one, then generate questions from it.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {notes.map((note) => (
            <li key={note.id}>
              <Link
                href={`/notes/${note.id}`}
                className="hover:bg-muted flex items-center justify-between gap-4 px-4 py-3"
              >
                <span className="truncate font-medium">{note.title}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {editedAt.format(note.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
