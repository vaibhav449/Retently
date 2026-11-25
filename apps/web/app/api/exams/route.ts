import { createExam, listExams } from "@repo/revision";
import { examDeps, examResponse, jsonBody, signInRequired } from "@/lib/exams";
import { getSession } from "@/lib/session";

/**
 * The student's exams (07-exam-mode.md §6): today's and upcoming ones by date; past ones too with
 * ?include_past=1.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return signInRequired();

  const { deps, shifted } = examDeps(request);
  const includePast = new URL(request.url).searchParams.get("include_past") === "1";
  return examResponse(shifted, async () => ({
    body: await listExams(session.user.id, { includePast }, deps),
  }));
}

/** A new exam: a date, the notes it covers and a target recall (07 §6). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return signInRequired();

  const { deps, shifted } = examDeps(request);
  return examResponse(shifted, async () => ({
    status: 201,
    body: await createExam(session.user.id, await jsonBody(request), deps),
  }));
}
