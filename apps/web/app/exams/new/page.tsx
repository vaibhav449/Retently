import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { ExamForm } from "../exam-form";
import { setupProps } from "../setup";

export const metadata: Metadata = { title: "Plan for an exam · Retently" };

export default function NewExamPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <Link
        href="/exams"
        className="text-muted-foreground self-start text-sm underline underline-offset-4"
      >
        All exams
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Plan for an exam</h1>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading your notes…</p>}>
        <NewExam />
      </Suspense>
    </main>
  );
}

async function NewExam() {
  const user = await requireUser();
  return <ExamForm {...await setupProps(user.id)} />;
}
