"use client";

import {
  generateQuestionsQueuedResponseSchema,
  type IngestCompletedPayload,
} from "@repo/contracts";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/button";
import { subscribe } from "@/lib/events";
import { IDLE, isBusy, MESSAGES, reduce, SLOW_AFTER_MS } from "./generate-questions-state";

interface GenerateQuestionsProps {
  documentId: string;
  /** The note's `sources` row, which the worker's events name. Null: nothing to generate from. */
  sourceId: string | null;
  /** Saves pending edits; false when they could not be saved. From useAutosave(). */
  flush: () => Promise<boolean>;
  disabled: boolean;
}

/**
 * The "Generate questions" button. Saves the note first, so questions come from the text on
 * screen, then queues the job and waits for the worker's ingest.completed (or ingest.failed) on
 * the /events socket. Autosave never does this. Nothing is kept across a reload.
 */
export function GenerateQuestions({
  documentId,
  sourceId,
  flush,
  disabled,
}: GenerateQuestionsProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reduce, IDLE);

  // Subscribed from the start, not on click: an unchanged note's run finishes in milliseconds,
  // so the socket must already be open when it does.
  useEffect(() => {
    if (!sourceId) return;
    const offCompleted = subscribe("ingest.completed", (event) => {
      if (event.payload.source_id === sourceId) {
        dispatch({ type: "completed", payload: event.payload });
      }
    });
    const offFailed = subscribe("ingest.failed", (event) => {
      if (event.payload.source_id === sourceId) {
        dispatch({ type: "failed", message: event.payload.error });
      }
    });
    return () => {
      offCompleted();
      offFailed();
    };
  }, [sourceId]);

  useEffect(() => {
    if (state.status !== "queued") return;
    const timer = setTimeout(() => dispatch({ type: "timeout" }), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state.status]);

  async function generate() {
    dispatch({ type: "click" });
    if (!(await flush())) {
      dispatch({ type: "flush_failed" });
      return;
    }
    dispatch({ type: "flushed" });
    try {
      const response = await fetch(`/api/documents/${documentId}/questions`, { method: "POST" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status !== 202) {
        dispatch({ type: "request_failed", status: response.status });
        return;
      }
      generateQuestionsQueuedResponseSchema.parse(await response.json());
      dispatch({ type: "accepted" });
    } catch (cause) {
      console.error(cause);
      dispatch({ type: "request_failed", status: 0 });
    }
  }

  const busy = isBusy(state);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" onClick={generate} disabled={disabled || !sourceId || busy}>
        <Sparkles />
        {busy ? "Generating questions…" : "Generate questions"}
      </Button>
      <div aria-live="polite" className="text-sm">
        {state.status === "slow" && <p className="text-muted-foreground">{MESSAGES.slow}</p>}
        {state.status === "done" && <Summary result={state.result} />}
        {(state.status === "failed" || state.status === "error") && (
          <p role="alert" className="text-destructive">
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Summary({ result }: { result: IngestCompletedPayload }) {
  const { items_created: created, chunks, chunks_pending: pending } = result;
  if (chunks === 0) {
    return (
      <p className="text-muted-foreground">
        Write a few more sentences first: there is nothing to ask about yet.
      </p>
    );
  }
  // An older worker sends only the count: then only what it made can be linked to.
  const withQuestions = chunks === undefined || pending === undefined ? created : chunks - pending;
  return (
    <div className="flex flex-col gap-1">
      <p>
        {created > 0
          ? `Made ${plural(created, "new question")}.`
          : pending
            ? "No new questions yet."
            : "No new questions: this note hasn't changed."}{" "}
        {withQuestions > 0 && (
          <Link href="/review" className="underline underline-offset-4">
            Review them
          </Link>
        )}
      </p>
      {pending !== undefined && pending > 0 && (
        <p className="text-muted-foreground">
          {result.budget_exhausted
            ? `Today's limit is reached; ${plural(pending, "passage")} will get questions tomorrow.`
            : `${plural(pending, "passage")} still without a question. Click again to continue.`}
        </p>
      )}
    </div>
  );
}
