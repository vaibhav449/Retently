import type { Exam } from "@repo/contracts";
import { ExamError, getExam } from "@repo/revision";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { pageExamDeps } from "@/lib/exams";
import { requireUser } from "@/lib/session";
import { ExamForm } from "../../exam-form";
import { setupProps } from "../../setup";

export const metadata: Metadata = { title: "Edit exam · Retently" };

export default function EditExamPage({ params }: PageProps<"/exams/[id]/edit">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <Link
        href="/exams"
        className="text-muted-foreground self-start text-sm underline underline-offset-4"
      >
        All exams
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Edit exam</h1>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading your exam…</p>}>
        <EditExam params={params} />
      </Suspense>
    </main>
  );
}

async function EditExam({ params }: Pick<PageProps<"/exams/[id]/edit">, "params">) {
  const user = await requireUser();
  const { id } = await params;
  let exam: Exam;
  try {
    exam = await getExam(user.id, id, pageExamDeps());
  } catch (error) {
    if (error instanceof ExamError && error.code === "not_found") notFound();
    throw error;
  }
  const readable = exam.scope.filter((entry) => entry.title !== null).map((entry) => entry.key);
  return (
    <ExamForm
      {...await setupProps(user.id)}
      exam={{
        id: exam.id,
        exam_date: exam.exam_date,
        topic_keys: readable,
        target_retention: exam.target_retention,
        deletedNotes: exam.topic_keys.length - readable.length,
      }}
    />
  );
}
