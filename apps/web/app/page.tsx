import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Study Workspace</h1>
      <p className="text-foreground/70">
        Notes and PDFs that turn into a personalised revision schedule.
      </p>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading your account…</p>}>
        <Account />
      </Suspense>
    </main>
  );
}

async function Account() {
  const user = await requireUser();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
      <p className="text-sm">
        Signed in as <span className="font-medium">{user.name}</span> ({user.email})
      </p>
      <SignOutButton />
    </div>
  );
}
