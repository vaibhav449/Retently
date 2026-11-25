import type { ExamForecast } from "@repo/contracts";
import {
  createDefaultRegistry,
  createForecastCache,
  DEFAULT_EXAM,
  DEFAULT_QUEUE,
  EXAM_ERROR_STATUS,
  type ExamDeps,
  ExamError,
  type ForecastCache,
  type ForecastDeps,
  systemClock,
} from "@repo/revision";
import { getDb } from "./db";
import { latencyMedians, reviewClock, reviewHeaders } from "./review-engine";

// One cache per process, kept on globalThis like the latency medians: route deps are built per
// request, and hot reload re-runs this module in development.
const globalForForecasts = globalThis as { retentlyForecastCache?: ForecastCache<ExamForecast> };

/** The process's forecast cache: 10 minutes, at most 500 forecasts (07 §5.2, EM-13). */
export function forecastCache(): ForecastCache<ExamForecast> {
  globalForForecasts.retentlyForecastCache ??= createForecastCache<ExamForecast>({
    ttlMs: DEFAULT_EXAM.cacheTtlMs,
    maxEntries: DEFAULT_EXAM.cacheMaxEntries,
    now: () => Date.now(),
  });
  return globalForForecasts.retentlyForecastCache;
}

export type WebExamDeps = ExamDeps & ForecastDeps & { cache: ForecastCache<ExamForecast> };

function depsWith(clock: ExamDeps["clock"]): WebExamDeps {
  return {
    db: getDb(),
    clock,
    registry: createDefaultRegistry(),
    queue: DEFAULT_QUEUE,
    exam: DEFAULT_EXAM,
    medians: latencyMedians(),
    cache: forecastCache(),
  };
}

/**
 * What the exam routes give the engine: the request's review clock (so the E2E test clock moves
 * "today" for exams too), the queue's cached latency medians and the process's forecast cache.
 */
export function examDeps(request: Request): { deps: WebExamDeps; shifted: boolean } {
  const { clock, shifted } = reviewClock(request);
  return { deps: depsWith(clock), shifted };
}

/** The same, for server-rendered pages: the system clock. */
export function pageExamDeps(): WebExamDeps {
  return depsWith(systemClock);
}

/** An exam error as the API's body and status (plan §4.6); null for any other error. Pure. */
export function examErrorBody(
  error: unknown,
): { status: number; body: { error: string; message: string; field?: string } } | null {
  if (!(error instanceof ExamError)) return null;
  return {
    status: EXAM_ERROR_STATUS[error.code],
    body: {
      error: error.code,
      message: error.message,
      ...(error.field !== undefined && { field: error.field }),
    },
  };
}

/** Runs an exam route's work: the result as JSON, an ExamError as its status, anything else thrown. */
export async function examResponse(
  shifted: boolean,
  work: () => Promise<{ status?: number; body?: unknown }>,
): Promise<Response> {
  const headers = reviewHeaders(shifted);
  try {
    const { status = 200, body } = await work();
    return body === undefined
      ? new Response(null, { status, headers })
      : Response.json(body, { status, headers });
  } catch (error) {
    const refused = examErrorBody(error);
    if (refused === null) throw error;
    return Response.json(refused.body, { status: refused.status, headers });
  }
}

/** A request's JSON body, or an ExamError("invalid_request"). */
export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ExamError("invalid_request", "The body is not JSON.");
  }
}

/** The unauthenticated response of every exam route, as on the review routes (EM-14). */
export function signInRequired(): Response {
  return Response.json({ error: "Sign in to plan exams" }, { status: 401 });
}
