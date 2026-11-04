"use client";

import { type GenerateQuestionsResponse, generateQuestionsResponseSchema } from "@repo/contracts";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface GenerateQuestionsProps {
  documentId: string;
  /** Saves pending edits; false when they could not be saved. From useAutosave(). */
  flush: () => Promise<boolean>;
  disabled: boolean;
}

type State =
  | { status: "idle" }
  | { status: "working" }
  | { status: "done"; result: GenerateQuestionsResponse }
  | { status: "error"; message: string };

/**
 * The "Generate questions" button. Saves the note first, so questions come from the text on
 * screen, then asks the server for one MCQ per passage that has none. Autosave never does this.
 */
export function GenerateQuestions({ documentId, flush, disabled }: GenerateQuestionsProps) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });

  async function generate() {
    setState({ status: "working" });
    if (!(await flush())) {
      setState({ status: "error", message: "Save the note first, then try again." });
      return;
    }
    try {
      const response = await fetch(`/api/documents/${documentId}/questions`, { method: "POST" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 503) {
        setState({ status: "error", message: "Question generation isn't set up yet." });
        return;
      }
      if (!response.ok) {
        throw new Error(`POST /api/documents/${documentId}/questions answered ${response.status}`);
      }
      setState({
        status: "done",
        result: generateQuestionsResponseSchema.parse(await response.json()),
      });
    } catch (cause) {
      console.error(cause);
      setState({ status: "error", message: "Couldn't generate questions. Try again." });
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" onClick={generate} disabled={disabled || state.status === "working"}>
        <Sparkles />
        {state.status === "working" ? "Generating…" : "Generate questions"}
      </Button>
      <div aria-live="polite" className="text-sm">
        {state.status === "done" && <Summary result={state.result} />}
        {state.status === "error" && (
          <p role="alert" className="text-destructive">
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Summary({ result }: { result: GenerateQuestionsResponse }) {
  if (result.chunks === 0) {
    return (
      <p className="text-muted-foreground">
        Write a few more sentences first: there is nothing to ask about yet.
      </p>
    );
  }
  const questions = result.items_created + result.items_skipped;
  return (
    <div className="flex flex-col gap-1">
      <p>
        {result.items_created > 0
          ? `Made ${plural(result.items_created, "new question")}.`
          : "No new questions: this note hasn't changed."}{" "}
        {questions > 0 && (
          <Link href="/review" className="underline underline-offset-4">
            Review them
          </Link>
        )}
      </p>
      {result.chunks_pending > 0 && (
        <p className="text-muted-foreground">
          {result.budget_exhausted
            ? `Today's limit is reached; ${plural(result.chunks_pending, "passage")} will get questions tomorrow.`
            : `${plural(result.chunks_pending, "passage")} still without a question. Click again to continue.`}
        </p>
      )}
    </div>
  );
}
