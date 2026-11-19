import { getDb } from "@/lib/db";
import { getNoteForGeneration } from "@/lib/documents";
import { requestQuestions } from "@/lib/generate-questions";
import { publishIngestJob } from "@/lib/jobs";
import { getSession } from "@/lib/session";

/**
 * "Generate questions": queues an `ingest.requested` job and answers 202 at once; the worker
 * makes the questions and the page hears about them on /events. See requestQuestions().
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/documents/[id]/questions">) {
  const session = await getSession();
  const { id } = await ctx.params;
  const result = await requestQuestions(id, {
    userId: session?.user.id ?? null,
    findNote: (userId, documentId) => getNoteForGeneration(getDb(), userId, documentId),
    publish: publishIngestJob,
    now: () => new Date(),
  });
  return Response.json(result.body, { status: result.status });
}
