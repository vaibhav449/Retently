import { deleteExam, updateExam } from "@repo/revision";
import { examDeps, examResponse, jsonBody, signInRequired } from "@/lib/exams";
import { getSession } from "@/lib/session";

/** Changes an exam's date, notes or target; only the fields sent are checked (07 §6). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/exams/[id]">) {
  const session = await getSession();
  if (!session) return signInRequired();

  const { id } = await ctx.params;
  const { deps, shifted } = examDeps(request);
  return examResponse(shifted, async () => ({
    body: await updateExam(session.user.id, id, await jsonBody(request), deps),
  }));
}

/** Deletes an exam. Today's review plan keeps what it was built with. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/exams/[id]">) {
  const session = await getSession();
  if (!session) return signInRequired();

  const { id } = await ctx.params;
  const { deps, shifted } = examDeps(request);
  return examResponse(shifted, async () => {
    await deleteExam(session.user.id, id, deps);
    return { status: 204 };
  });
}
