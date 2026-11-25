import { type ExamForecast, examForecastSchema } from "@repo/contracts";
import { type ForecastCache, forecastKey } from "./cache";
import { buildForecast } from "./forecast";
import { type ForecastDeps, loadForecastInput } from "./load";
import { ExamError } from "./validate";

/**
 * GET /api/exams/:id/forecast (07 §5–§7, ER4.5): computed on demand from the database as it is
 * now; with `cache`, a forecast of the same inputs (forecastKey()) computed within its TTL is
 * returned instead, with its own computed_at. The read always runs, so a review, a retired item or
 * an edited exam always misses. Throws not_found for an exam that is not the user's.
 */
export async function forecastFor(
  userId: string,
  examId: string,
  deps: ForecastDeps & { cache?: ForecastCache<ExamForecast> },
): Promise<ExamForecast> {
  const input = await loadForecastInput(userId, examId, deps);
  if (input === null) throw new ExamError("not_found", "No such exam.");
  const key = deps.cache === undefined ? null : forecastKey(input);
  if (key !== null) {
    const cached = deps.cache?.get(key);
    if (cached !== undefined) return cached;
  }
  const forecast = examForecastSchema.parse(buildForecast(input, deps.exam));
  if (key !== null) deps.cache?.set(key, forecast);
  return forecast;
}
