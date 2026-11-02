"use client";

import { documentTitleSchema, renameDocumentResponseSchema } from "@repo/contracts";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The note's title, saved on submit or blur, and the delete button. */
export function NoteHeader({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const inputId = useId();
  const [saved, setSaved] = useState(title);
  const [draft, setDraft] = useState(title);
  // Separate flags: blurring the title to click Delete starts a save, which must not block the delete.
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rename(event?: FormEvent) {
    event?.preventDefault();
    // Enter submits, then the blur that follows would send the same title again.
    if (saving || deleting) return;
    const parsed = documentTitleSchema.safeParse(draft);
    if (!parsed.success) {
      setError("A title needs 1 to 200 characters.");
      return;
    }
    if (parsed.data === saved) {
      setDraft(saved);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: parsed.data }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error(`PATCH /api/documents/${id} answered ${response.status}`);
      const body = renameDocumentResponseSchema.parse(await response.json());
      setSaved(body.title);
      setDraft(body.title);
    } catch (cause) {
      console.error(cause);
      setError("Couldn't save the title. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${saved}" and the questions made from it?`)) return;

    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error(`DELETE /api/documents/${id} answered ${response.status}`);
      router.replace("/notes");
      router.refresh();
    } catch (cause) {
      console.error(cause);
      setError("Couldn't delete the note. Try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={rename} className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={inputId}>Title</Label>
          <Input
            id={inputId}
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void rename()}
            disabled={deleting}
            className="h-10 text-lg font-semibold"
          />
        </div>
        <Button type="button" variant="outline" onClick={remove} disabled={deleting}>
          <Trash2 />
          {deleting ? "Deleting…" : "Delete"}
        </Button>
      </form>
      <p aria-live="polite" className="text-muted-foreground h-4 text-xs">
        {saving ? "Saving…" : null}
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
