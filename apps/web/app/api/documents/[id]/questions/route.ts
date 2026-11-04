import type { GenerateQuestionsResponse } from "@repo/contracts";
import { IngestError, ingestSource } from "@repo/ingest";
import { defaultModel } from "@repo/llm";
import { systemClock } from "@repo/revision";
import { getDb } from "@/lib/db";
import { getDocumentSourceId } from "@/lib/documents";
import { getLlmEnv } from "@/lib/llm-env";
import { getSession } from "@/lib/session";

// Someone else's note answers 404, the same as a missing one, so ids cannot be probed.
const NOT_FOUND = { error: "not_found", message: "No such note" };

/**
 * Turns the note's saved Markdown into MCQs ("Generate questions"). Runs ingestSource() in the
 * request, as there is no worker yet; the client flushes its autosave first, so the saved text is
 * what the student sees. Idempotent: clicking again on an unchanged note calls no model.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/documents/[id]/questions">) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Sign in to generate questions" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const db = getDb();
  const sourceId = await getDocumentSourceId(db, session.user.id, id);
  if (!sourceId) return Response.json(NOT_FOUND, { status: 404 });

  const env = getLlmEnv();
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json(
      { error: "llm_not_configured", message: "Question generation is not set up on this server" },
      { status: 503 },
    );
  }

  try {
    const result = await ingestSource(sourceId, {
      db,
      clock: systemClock,
      dailyBudgetUsd: env.LLM_DAILY_BUDGET_USD,
      model: defaultModel,
    });
    return Response.json({
      chunks: result.chunks,
      items_created: result.itemsCreated,
      items_skipped: result.itemsSkipped,
      budget_exhausted: result.budgetExhausted,
      chunks_pending: result.chunksPending,
    } satisfies GenerateQuestionsResponse);
  } catch (error) {
    if (error instanceof IngestError) {
      return Response.json(NOT_FOUND, { status: 404 });
    }
    // The model provider failed (bad key, outage, rate limit). Questions made so far are kept.
    console.error(error);
    return Response.json(
      { error: "llm_failed", message: "Couldn't reach the question generator" },
      { status: 502 },
    );
  }
}
