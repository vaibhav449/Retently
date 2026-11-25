import { forecastFor } from "@repo/revision";
import { examDeps, examResponse, signInRequired } from "@/lib/exams";
import { getSession } from "@/lib/session";

/**
 * The exam's forecast (07-exam-mode.md §5–§7): predicted recall on exam day, the daily plan that
 * reaches the target, and the status sentence's inputs. Reused for 10 minutes while nothing
 * changes.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/exams/[id]/forecast">) {
  const session = await getSession();
  if (!session) return signInRequired();

  const { id } = await ctx.params;
  const { deps, shifted } = examDeps(request);
  return examResponse(shifted, async () => ({
    body: await forecastFor(session.user.id, id, deps),
  }));
}
