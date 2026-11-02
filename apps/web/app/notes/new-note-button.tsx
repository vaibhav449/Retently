"use client";

import { createDocumentResponseSchema } from "@repo/contracts";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** POST /api/documents, then opens the new note. */
export function NewNoteButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "creating" | "failed">("idle");

  async function create() {
    setState("creating");
    try {
      const response = await fetch("/api/documents", { method: "POST" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error(`POST /api/documents answered ${response.status}`);
      const { id } = createDocumentResponseSchema.parse(await response.json());
      router.push(`/notes/${id}`);
    } catch (error) {
      console.error(error);
      setState("failed");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={create} disabled={state === "creating"}>
        <Plus />
        {state === "creating" ? "Creating…" : "New note"}
      </Button>
      {state === "failed" && (
        <p role="alert" className="text-destructive text-sm">
          Couldn&apos;t create a note. Try again.
        </p>
      )}
    </div>
  );
}
