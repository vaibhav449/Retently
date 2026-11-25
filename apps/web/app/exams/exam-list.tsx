"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Delete with an in-page confirmation (ER5.3): the first click asks, "Yes, delete" sends
 * DELETE /api/exams/:id and refreshes the list.
 */
export function DeleteExamButton({ examId, label }: { examId: string; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirm" | "deleting" | "failed">("idle");

  async function remove() {
    setState("deleting");
    try {
      const response = await fetch(`/api/exams/${examId}`, { method: "DELETE" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      // Already gone (another tab) is as good as deleted.
      if (!response.ok && response.status !== 404) {
        throw new Error(`DELETE /api/exams/${examId} answered ${response.status}`);
      }
      router.refresh();
    } catch (error) {
      console.error(error);
      setState("failed");
    }
  }

  if (state === "idle") {
    return (
      <Button variant="ghost" size="sm" onClick={() => setState("confirm")}>
        Delete
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`Delete ${label}?`} className="flex flex-wrap items-center gap-2">
      <span className="text-sm">
        {state === "failed" ? "Couldn't delete it. Try again?" : "Delete this exam?"}
      </span>
      <Button
        variant="destructive"
        size="sm"
        disabled={state === "deleting"}
        onClick={() => void remove()}
      >
        Yes, delete
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={state === "deleting"}
        onClick={() => setState("idle")}
      >
        Cancel
      </Button>
    </div>
  );
}
