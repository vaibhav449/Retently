import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { ReviewSession } from "./review-session";

export const metadata: Metadata = { title: "Review · Retently" };

export default function ReviewPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Review</h1>
        <Link href="/" className="text-muted-foreground text-sm underline underline-offset-4">
          Home
        </Link>
      </div>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading your account…</p>}>
        <SignedInSession />
      </Suspense>
    </main>
  );
}

async function SignedInSession() {
  // proxy.ts only saw a cookie; this checks the session before the questions load.
  await requireUser();
  return <ReviewSession />;
}
