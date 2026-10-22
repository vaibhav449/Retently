"use client";

import {
  type Citation,
  type Confidence,
  type McqOption,
  type ReviewCategory,
  type ReviewItemView,
  type ReviewResult,
  reviewAnswerResponseSchema,
  reviewNextResponseSchema,
  type SessionProgress,
} from "@repo/contracts";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CONFIDENCES: { value: Confidence; label: string }[] = [
  { value: "sure", label: "Sure" },
  { value: "think_so", label: "Think so" },
  { value: "no_idea", label: "No idea" },
];

const CATEGORY_LABELS: Record<ReviewCategory, string> = {
  new: "New",
  review: "Review",
  misconception: "Retest",
};

/** Answers the server refused, by status (05-review-pipeline.md §8.2). Retrying would not help. */
const REFUSALS: Record<number, string> = {
  400: "This question can no longer be answered.",
  403: "You no longer have access to this question.",
  409: "You answered this question in another tab a moment ago.",
  422: "This answer could not be checked.",
};

const relativeDays = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const shortDate = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});

type SessionState =
  | { name: "loading" }
  | { name: "question"; view: ReviewItemView; progress: SessionProgress }
  | { name: "nothing_due" | "done_for_today" }
  | { name: "failed" };

/** GET /api/review/next, as the state the session moves to. */
async function loadNext(signal?: AbortSignal): Promise<SessionState | "signed_out"> {
  try {
    const response = await fetch("/api/review/next", { signal });
    if (response.status === 401) return "signed_out";
    if (!response.ok) throw new Error(`GET /api/review/next answered ${response.status}`);
    const next = reviewNextResponseSchema.parse(await response.json());
    if (next.state !== "ok") return { name: next.state };
    return { name: "question", view: next.item, progress: next.progress };
  } catch (error) {
    if (!signal?.aborted) console.error(error);
    return { name: "failed" };
  }
}

/**
 * One question at a time from GET /api/review/next, until nothing is left. Every question, the
 * first included, is fetched here after hydration instead of being rendered on the server, so
 * latency is measured the same way for all of them.
 */
export function ReviewSession() {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>({ name: "loading" });

  const show = useCallback(
    (next: SessionState | "signed_out") => {
      if (next === "signed_out") router.replace("/login");
      else setSession(next);
    },
    [router],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadNext(controller.signal).then((next) => {
      if (!controller.signal.aborted) show(next);
    });
    return () => controller.abort();
  }, [show]);

  function showNext() {
    setSession({ name: "loading" });
    void loadNext().then(show);
  }

  switch (session.name) {
    case "loading":
      return <p className="text-muted-foreground text-sm">Loading your next question…</p>;
    case "question":
      return (
        <QuestionCard
          // A new key per presentation resets the confidence, the answer and the timer.
          key={session.view.presentation_token}
          view={session.view}
          progress={session.progress}
          onNext={showNext}
          onSignedOut={() => router.replace("/login")}
        />
      );
    case "nothing_due":
      return (
        <Notice title="Nothing to review right now">
          New questions show up here once they are generated from your notes.
        </Notice>
      );
    case "done_for_today":
      // "Study more" (can_extend) waits for the extend endpoint, which comes with daily sessions.
      return <Notice title="Done for today">Come back tomorrow for your next reviews.</Notice>;
    case "failed":
      return (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-destructive text-sm">
            Couldn&apos;t load your next question.
          </p>
          <Button variant="outline" onClick={showNext}>
            Try again
          </Button>
        </div>
      );
  }
}

/** What the student did, kept so that a failed save is retried with exactly the same answer. */
interface Submission {
  optionId: string;
  confidence: Confidence;
  latencyMs: number;
}

type AnswerState =
  | { name: "unanswered" }
  | { name: "sending"; submission: Submission }
  | { name: "graded"; submission: Submission; result: ReviewResult }
  | { name: "failed"; submission: Submission; message: string; canRetry: boolean };

interface QuestionCardProps {
  view: ReviewItemView;
  progress: SessionProgress;
  onNext: () => void;
  onSignedOut: () => void;
}

/**
 * D-14: the stem and the options show together, the options stay disabled until a confidence is
 * picked, and latency runs from first render to submit.
 */
function QuestionCard({ view, progress, onNext, onSignedOut }: QuestionCardProps) {
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [answer, setAnswer] = useState<AnswerState>({ name: "unanswered" });
  const shownAt = useRef(0);
  const confidenceLabel = useId();

  useEffect(() => {
    shownAt.current = performance.now();
  }, []);

  function choose(optionId: string) {
    if (confidence === null) return;
    void send({
      optionId,
      confidence,
      latencyMs: Math.round(performance.now() - shownAt.current),
    });
  }

  async function send(submission: Submission) {
    setAnswer({ name: "sending", submission });
    try {
      const response = await fetch("/api/review/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          presentation_token: view.presentation_token,
          confidence: submission.confidence,
          response: { kind: "mcq", option_id: submission.optionId },
          client_latency_ms: submission.latencyMs,
        }),
      });
      if (response.status === 401) {
        onSignedOut();
        return;
      }
      if (response.status === 410) {
        // Retired after it was shown. Nothing was recorded, so skip to the next one.
        onNext();
        return;
      }
      const refusal = REFUSALS[response.status];
      if (refusal) {
        setAnswer({ name: "failed", submission, message: refusal, canRetry: false });
        return;
      }
      if (!response.ok) throw new Error(`POST /api/review/answer answered ${response.status}`);
      const body = reviewAnswerResponseSchema.parse(await response.json());
      // Only MCQs are presented so far, and they are graded at once. Short answers (202) will
      // get their result on /events.
      if (body.status === "grading") throw new Error(`review ${body.review_id} is still grading`);
      setAnswer({ name: "graded", submission, result: body.result });
    } catch (error) {
      console.error(error);
      // Safe to retry: the presentation token makes a second save of the same answer a no-op.
      setAnswer({
        name: "failed",
        submission,
        message: "Your answer could not be saved.",
        canRetry: true,
      });
    }
  }

  const answered = answer.name !== "unanswered";
  const chosen = answered ? answer.submission.optionId : null;
  const result = answer.name === "graded" ? answer.result : null;

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          {CATEGORY_LABELS[view.category]} · {progress.done} of {progress.planned} done today
        </CardDescription>
        <CardTitle className="text-lg">
          <h2>{view.item.prompt}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p id={confidenceLabel} className="text-sm font-medium">
            How sure are you?
          </p>
          <div role="group" aria-labelledby={confidenceLabel} className="flex flex-wrap gap-2">
            {CONFIDENCES.map(({ value, label }) => (
              <Button
                key={value}
                variant={confidence === value ? "default" : "outline"}
                aria-pressed={confidence === value}
                disabled={answered}
                onClick={() => setConfidence(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {!answered && (
            <p className="text-muted-foreground text-sm">
              {confidence === null
                ? "Pick how sure you are to unlock the options."
                : "Now pick your answer."}
            </p>
          )}
          {/* MCQ only: nothing else is presented until the cloze and short-answer screens. */}
          <ul aria-label="Options" className="flex flex-col gap-2">
            {view.item.options.map((option) => (
              <li key={option.id}>
                <OptionButton
                  option={option}
                  mark={markOf(option, chosen, result)}
                  disabled={confidence === null || answered}
                  onChoose={() => choose(option.id)}
                />
              </li>
            ))}
          </ul>
        </div>
        {answer.name === "sending" && <p className="text-muted-foreground text-sm">Checking…</p>}
        {answer.name === "failed" && (
          <p role="alert" className="text-destructive text-sm">
            {answer.message}
          </p>
        )}
        {result && <Reveal result={result} />}
      </CardContent>
      {answer.name === "graded" && (
        <CardFooter>
          <Button onClick={onNext}>Next question</Button>
        </CardFooter>
      )}
      {answer.name === "failed" && (
        <CardFooter className="gap-2">
          {answer.canRetry ? (
            <>
              <Button onClick={() => void send(answer.submission)}>Try again</Button>
              <Button variant="outline" onClick={onNext}>
                Skip
              </Button>
            </>
          ) : (
            <Button onClick={onNext}>Next question</Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

type Mark = "chosen" | "right" | "wrong" | null;

function markOf(option: McqOption, chosen: string | null, result: ReviewResult | null): Mark {
  if (result === null) return option.id === chosen ? "chosen" : null;
  // Option texts are unique within an item (contracts/item.ts), so the text names the right one.
  if (option.text === result.correct_answer) return "right";
  return option.id === chosen ? "wrong" : null;
}

interface OptionButtonProps {
  option: McqOption;
  mark: Mark;
  disabled: boolean;
  onChoose: () => void;
}

function OptionButton({ option, mark, disabled, onChoose }: OptionButtonProps) {
  return (
    <Button
      variant="outline"
      disabled={disabled}
      onClick={onChoose}
      className={cn(
        "h-auto min-h-10 w-full justify-start gap-2 px-3 py-2 text-left whitespace-normal",
        mark !== null && "disabled:opacity-100",
        mark === "chosen" && "border-ring",
        mark === "right" &&
          "border-emerald-600/60 bg-emerald-600/10 dark:border-emerald-400/60 dark:bg-emerald-400/10",
        mark === "wrong" && "border-destructive/60 bg-destructive/10",
      )}
    >
      <span className="flex-1">{option.text}</span>
      {mark === "right" && (
        <>
          <Check aria-hidden className="text-emerald-600 dark:text-emerald-400" />
          <span className="sr-only">(correct answer)</span>
        </>
      )}
      {mark === "wrong" && (
        <>
          <X aria-hidden className="text-destructive" />
          <span className="sr-only">(your answer)</span>
        </>
      )}
    </Button>
  );
}

function Reveal({ result }: { result: ReviewResult }) {
  const { misconception } = result;
  const container = useRef<HTMLDivElement>(null);

  // Focus moves here, so a screen reader reads the result out, and Tab reaches "Next question".
  useEffect(() => {
    container.current?.focus();
  }, []);

  return (
    <div
      ref={container}
      tabIndex={-1}
      className="focus-visible:ring-ring/50 flex flex-col gap-3 rounded-lg border p-4 outline-none focus-visible:ring-3"
    >
      <p
        className={cn(
          "font-medium",
          result.correct ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
        )}
      >
        {result.correct ? "Correct" : "Not quite"}
      </p>
      {misconception ? (
        // A confident wrong answer: the learning moment of 05 §6.4.
        <p>
          You were sure it was “{misconception.your_answer}”, but the answer is “
          {misconception.correct_answer}”. Here’s what your notes say:
        </p>
      ) : (
        !result.correct && <p>The answer is “{result.correct_answer}”.</p>
      )}
      <CitationQuote citation={result.citation} />
      <p className="text-muted-foreground text-sm">
        Next review {relativeDays.format(result.scheduled_days, "day")} (
        {shortDate.format(new Date(result.next_due_at))}).
      </p>
    </div>
  );
}

/** Plain text until the Citation component (Phase 2) links to the note block or the PDF page. */
function CitationQuote({ citation }: { citation: Citation }) {
  return (
    <figure className="border-l-2 pl-3">
      <blockquote className="text-sm">{citation.snippet}</blockquote>
      <figcaption className="text-muted-foreground mt-1 text-xs">
        {citation.title}
        {citation.page !== undefined && `, page ${citation.page}`}
      </figcaption>
    </figure>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{children}</CardDescription>
      </CardHeader>
    </Card>
  );
}
