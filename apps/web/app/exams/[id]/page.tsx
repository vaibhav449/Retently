import { type ExamForecast, renderExamHeadline } from "@repo/contracts";
import { ExamError, forecastFor } from "@repo/revision";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pageExamDeps } from "@/lib/exams";
import { requireUser } from "@/lib/session";
import { addDays, dayLabels, daysLeftLabel, examDateLabel } from "../format";
import { DailyPlanBars, RecallHistogram } from "./bars";

export const metadata: Metadata = { title: "Exam forecast · Retently" };

export default function ExamForecastPage({ params }: PageProps<"/exams/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <Link
        href="/exams"
        className="text-muted-foreground self-start text-sm underline underline-offset-4"
      >
        All exams
      </Link>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Working out your plan…</p>}>
        <Forecast params={params} />
      </Suspense>
    </main>
  );
}

async function Forecast({ params }: Pick<PageProps<"/exams/[id]">, "params">) {
  const user = await requireUser();
  const { id } = await params;
  let forecast: ExamForecast;
  try {
    forecast = await forecastFor(user.id, id, pageExamDeps());
  } catch (error) {
    // Someone else's exam looks exactly like a missing one.
    if (error instanceof ExamError && error.code === "not_found") notFound();
    throw error;
  }
  return <ForecastView forecast={forecast} />;
}

/** The forecast (ER5.2): the headline, the numbers, recall now vs with the plan, the daily plan. */
function ForecastView({ forecast }: { forecast: ExamForecast }) {
  const { exam, plan, items } = forecast;
  const targetPct = Math.round(100 * exam.target_retention);
  const today = addDays(exam.exam_date, -exam.days_left);
  const notes = exam.topic_keys.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          Exam on {examDateLabel(exam.exam_date)}
        </h1>
        <p className="text-muted-foreground text-sm">
          {daysLeftLabel(exam.days_left)} · {notes} {notes === 1 ? "note" : "notes"} · {items.total}{" "}
          {items.total === 1 ? "question" : "questions"} · target {targetPct}%
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <p data-testid="exam-headline" className="text-lg leading-snug">
              {renderExamHeadline(forecast.headline)}
            </p>
          </CardTitle>
          {forecast.approximate && (
            <CardDescription>
              Some of these questions are on an older scheduler, so their numbers are approximate.
            </CardDescription>
          )}
        </CardHeader>
        {forecast.status !== "no_items" && forecast.status !== "exam_passed" && (
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Reviews needed a day">{plan.required_per_day ?? "—"}</Stat>
              <Stat label="Plan for, a day">
                {plan.recommended_per_day ?? "—"}
                {plan.minutes_per_day !== null && plan.minutes_per_day > 0 && (
                  <span className="text-muted-foreground text-sm font-normal">
                    {" "}
                    (~{plan.minutes_per_day} min)
                  </span>
                )}
              </Stat>
              <Stat label="Your daily slots">{forecast.at_current_pace.slots_per_day}</Stat>
              <Stat label="At target if you stop now">
                {forecast.if_nothing_more.at_target}/{items.total}
              </Stat>
            </dl>
          </CardContent>
        )}
      </Card>

      {items.total > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Predicted recall on exam day</h2>
          <RecallHistogram
            now={forecast.if_nothing_more.histogram}
            withPlan={plan.histogram}
            targetPct={targetPct}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Daily plan</h2>
        {plan.per_day.length > 0 ? (
          <DailyPlanBars perDay={plan.per_day} dayLabels={dayLabels(today, plan.per_day.length)} />
        ) : (
          <p className="text-muted-foreground text-sm">
            {forecast.status === "exam_passed"
              ? "This exam is over."
              : items.total === 0
                ? "Nothing to plan until these notes have questions."
                : "No study days are left before the exam."}
          </p>
        )}
      </section>

      <footer className="text-muted-foreground flex flex-col gap-2 border-t pt-4 text-xs">
        <p className="font-medium">How this is worked out</p>
        <ul className="list-disc space-y-1 pl-4">
          {forecast.assumptions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </footer>

      <nav className="flex flex-wrap gap-4 text-sm">
        <Link href={`/exams/${exam.id}/edit`} className="underline underline-offset-4">
          Edit exam
        </Link>
        <Link href="/review" className="underline underline-offset-4">
          Start today&apos;s review
        </Link>
      </nav>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
