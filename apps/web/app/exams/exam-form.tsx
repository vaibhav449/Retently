"use client";

import { examSchema } from "@repo/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ScopeOption {
  key: string;
  title: string;
  /** Questions the review screen can serve from this note. */
  items: number;
}

export interface ExamFormProps {
  /** The exam being edited; absent for a new one. */
  exam?: {
    id: string;
    exam_date: string;
    /** Only the keys whose note still exists and is readable. */
    topic_keys: string[];
    target_retention: number;
    /** Notes in the exam that were deleted since. */
    deletedNotes: number;
  };
  options: ScopeOption[];
  /** The student's local today and the latest date allowed, "YYYY-MM-DD". */
  today: string;
  maxDate: string;
  /** 1 / m(T) for each target in steps of 0.01 (07 §2): stability needed relative to 90 %. */
  multipliers: { target: number; multiplier: number }[];
  bounds: readonly [number, number];
  defaultTarget: number;
}

/** What each refusal means to the student (plan §4.6). */
const ERRORS: Record<string, string> = {
  invalid_date: "Pick today or a later date.",
  date_too_far: "Pick a date within the next year.",
  invalid_target: "Pick a target from 80% to 97%.",
  empty_scope: "Choose at least one note.",
  unreadable_scope:
    "One of the chosen notes is no longer available. Reload the page and try again.",
  too_many_exams: "You already have 10 upcoming exams. Delete one first.",
  not_found: "This exam no longer exists.",
};

/** The trade-off of a target, in plain words (07 §2, ER5.1). */
export function tradeOff(
  target: number,
  multipliers: ExamFormProps["multipliers"],
  defaultTarget: number,
): string {
  const pct = Math.round(100 * target);
  const row = multipliers.find((entry) => Math.round(100 * entry.target) === pct);
  if (row === undefined || pct === Math.round(100 * defaultTarget)) {
    return `${pct}% is what your reviews aim for anyway, so no extra work beyond your normal reviews.`;
  }
  const times = `${row.multiplier.toFixed(1)}×`;
  if (pct > 90) {
    return `At ${pct}% each question needs about ${times} the memory strength it needs at 90%, so expect ${row.multiplier >= 1.5 ? "far " : ""}more reviews.`;
  }
  return `At ${pct}% each question needs only about ${times} the memory strength it needs at 90%: fewer reviews, but more of it will have slipped by exam day.`;
}

/**
 * Exam setup (ER5.1): the date, the notes it covers and the target recall, with the target's
 * trade-off spelled out. Creates with POST /api/exams; edits send only what changed.
 */
export function ExamForm(props: ExamFormProps) {
  const { exam, options, today, maxDate, multipliers, bounds, defaultTarget } = props;
  const router = useRouter();
  const [examDate, setExamDate] = useState(exam?.exam_date ?? "");
  const [keys, setKeys] = useState<Set<string>>(new Set(exam?.topic_keys ?? []));
  const [target, setTarget] = useState(exam?.target_retention ?? defaultTarget);
  const [state, setState] = useState<
    { name: "idle" | "saving" } | { name: "error"; message: string }
  >({ name: "idle" });
  const dateId = useId();
  const targetId = useId();
  const tradeOffId = useId();
  const pastExam = exam !== undefined && exam.exam_date < today;

  function toggle(key: string, checked: boolean) {
    setKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (keys.size === 0) {
      setState({ name: "error", message: ERRORS.empty_scope as string });
      return;
    }
    const topicKeys = options.map((option) => option.key).filter((key) => keys.has(key));
    const targetRetention = Math.round(target * 100) / 100;
    let body: Record<string, unknown>;
    if (exam === undefined) {
      body = { exam_date: examDate, topic_keys: topicKeys, target_retention: targetRetention };
    } else {
      body = {};
      if (examDate !== exam.exam_date) body.exam_date = examDate;
      const sameScope =
        exam.deletedNotes === 0 &&
        topicKeys.length === exam.topic_keys.length &&
        topicKeys.every((key) => exam.topic_keys.includes(key));
      if (!sameScope) body.topic_keys = topicKeys;
      if (targetRetention !== exam.target_retention) body.target_retention = targetRetention;
      if (Object.keys(body).length === 0) {
        router.push(`/exams/${exam.id}`);
        return;
      }
    }

    setState({ name: "saving" });
    try {
      const response = await fetch(exam === undefined ? "/api/exams" : `/api/exams/${exam.id}`, {
        method: exam === undefined ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        const refusal = (await response.json().catch(() => ({}))) as { error?: string };
        setState({
          name: "error",
          message: ERRORS[refusal.error ?? ""] ?? "Your exam could not be saved. Try again.",
        });
        return;
      }
      const saved = examSchema.parse(await response.json());
      router.push(`/exams/${saved.id}`);
    } catch (error) {
      console.error(error);
      setState({ name: "error", message: "Your exam could not be saved. Try again." });
    }
  }

  const pct = Math.round(100 * target);
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor={dateId}>Exam date</Label>
        <Input
          id={dateId}
          type="date"
          required
          min={pastExam ? undefined : today}
          max={maxDate}
          value={examDate}
          onChange={(event) => setExamDate(event.target.value)}
          className="w-auto self-start"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Notes this exam covers</legend>
        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You have no notes yet. Write one and generate questions from it first.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {options.map((option) => (
              <li key={option.key}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={keys.has(option.key)}
                    onChange={(event) => toggle(option.key, event.target.checked)}
                  />
                  <span>{option.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {option.items} {option.items === 1 ? "question" : "questions"}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {exam !== undefined && exam.deletedNotes > 0 && (
          <p className="text-muted-foreground text-xs">
            {exam.deletedNotes === 1 ? "One note" : `${exam.deletedNotes} notes`} in this exam
            {exam.deletedNotes === 1 ? " was" : " were"} deleted and no longer count.
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor={targetId}>Target recall on exam day: {pct}%</Label>
        <input
          id={targetId}
          type="range"
          min={bounds[0]}
          max={bounds[1]}
          step={0.01}
          value={target}
          aria-valuetext={`${pct}%`}
          aria-describedby={tradeOffId}
          onChange={(event) => setTarget(Number(event.target.value))}
          className="w-full max-w-sm"
        />
        <p id={tradeOffId} className="text-muted-foreground text-sm" aria-live="polite">
          {tradeOff(target, multipliers, defaultTarget)}
        </p>
      </div>

      {state.name === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={state.name === "saving" || options.length === 0}>
          {exam === undefined ? "Save and see the forecast" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(exam === undefined ? "/exams" : `/exams/${exam.id}`)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
