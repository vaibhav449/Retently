import Link from "next/link";

export default function NoteNotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Note not found</h1>
      <p className="text-muted-foreground text-sm">
        It may have been deleted, or it belongs to someone else.
      </p>
      <Link href="/notes" className="text-sm underline underline-offset-4">
        Back to your notes
      </Link>
    </div>
  );
}
