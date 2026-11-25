import type { Exam } from "@repo/contracts";
import { listExams } from "@repo/revision";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { pageExamDeps } from "@/lib/exams";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { DeleteExamButton } from "./exam-list";
import { daysLeftLabel, examDateLabel } from "./format";

export const metadata: Metadata = { title: "Exams · Retently" };

export default function ExamsPage({ searchParams }: PageProps<"/exams">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Exams</h1>
        <Link href="/" className="text-muted-foreground text-sm underline underline-offset-4">
          Home
        </Link>
      </div>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading your exams…</p>}>
        <ExamList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ExamList({ searchParams }: Pick<PageProps<"/exams">, "searchParams">) {
  const user = await requireUser();
  const includePast = (await searchParams).past === "1";
  const { exams } = await listExams(user.id, { includePast }, pageExamDeps());

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Set an exam date and the notes it covers: your daily review leans towards them as the day
        gets closer, and the forecast shows how many reviews a day get you there.
      </p>
      <Link href="/exams/new" className={cn(buttonVariants(), "self-start")}>
        Plan for an exam
      </Link>
      {exams.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {includePast ? "No exams yet." : "No upcoming exams."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {exams.map((exam) => (
            <ExamRow key={exam.id} exam={exam} />
          ))}
        </ul>
      )}
      <Link
        href={includePast ? "/exams" : "/exams?past=1"}
        className="text-muted-foreground self-start text-sm underline underline-offset-4"
      >
        {includePast ? "Hide past exams" : "Show past exams"}
      </Link>
    </div>
  );
}

function ExamRow({ exam }: { exam: Exam }) {
  const label = `the exam on ${examDateLabel(exam.exam_date)}`;
  const titles = exam.scope.map((entry) => entry.title ?? "(deleted note)");
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/exams/${exam.id}`} className="font-medium underline-offset-4 hover:underline">
          {examDateLabel(exam.exam_date)}
        </Link>
        <span
          className={cn(
            "text-xs",
            exam.status === "past" ? "text-muted-foreground" : "font-medium",
          )}
        >
          {daysLeftLabel(exam.days_left)}
        </span>
      </div>
      <p className="text-muted-foreground text-sm">
        {titles.join(", ")} · target {Math.round(100 * exam.target_retention)}%
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/exams/${exam.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          aria-label={`Forecast for ${label}`}
        >
          Forecast
        </Link>
        <Link
          href={`/exams/${exam.id}/edit`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          aria-label={`Edit ${label}`}
        >
          Edit
        </Link>
        <DeleteExamButton examId={exam.id} label={label} />
      </div>
    </li>
  );
}
