import type { ItemType } from "@repo/contracts";
import { type Database, itemsReadableBy } from "@repo/db";
import type { CardState, SchedulerRegistry } from "@repo/scheduler";
import type { ExamConfig, QueueConfig } from "../config";
import type { LatencyMedianSource } from "../grading/latency";
import { effectiveDueAt } from "../misconception";
import { avgCostSec, costModel, slotsFor } from "../queue/budget";
import type { Clock } from "../record/recordReview";
import { userRevisionSettings } from "../settings";
import { localDateOf } from "../time";
import { findExam } from "./exams";
import type { ForecastInput } from "./forecast";
import type { SimItem } from "./simulate";
import { parseTopicKey } from "./validate";

export interface ForecastDeps {
  db: Database;
  clock: Clock;
  registry: SchedulerRegistry;
  queue: QueueConfig;
  exam: ExamConfig;
  /** The latency medians of the cost model, as the queue reads them (QD-8). */
  medians: LatencyMedianSource;
}

/** No review is being graded when the forecast asks for a median; no review_log id is all zeros. */
const NO_REVIEW_ID = "00000000-0000-0000-0000-000000000000";

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Everything the forecast of the user's exam `examId` is computed from (07 §5, EM-8), or null when
 * there is no such exam for this user. In scope = the items the queue could serve: readable
 * (itemsReadableBy()), live, of a served type, not pending, on a note in the exam's scope; a key
 * whose note is gone or unreadable covers nothing (E8). Never-reviewed items come in the queue's
 * new-pool order. Slots and the average cost are the queue's (06 §5); the grades feed λ.
 */
export async function loadForecastInput(
  userId: string,
  examId: string,
  deps: ForecastDeps,
): Promise<ForecastInput | null> {
  const { db } = deps;
  const exam = await findExam(db, userId, examId);
  if (exam === null) return null;
  const now = deps.clock.now();
  const sourceIds = exam.topicKeys.map(parseTopicKey).filter((id) => id !== null);
  const reviewWindow = Math.max(deps.exam.lapseWindow, deps.queue.costWindow);

  const [{ timeZone, budgetSec }, items, recent] = await Promise.all([
    userRevisionSettings(db, userId, deps.queue),
    db.item.findMany({
      where: {
        AND: [itemsReadableBy(userId), { sourceChunk: { sourceId: { in: sourceIds } } }],
        retiredAt: null,
        type: { in: [...deps.queue.servedTypes] },
      },
      select: {
        id: true,
        createdAt: true,
        sourceChunk: {
          select: { sourceId: true, createdAt: true, source: { select: { createdAt: true } } },
        },
      },
    }),
    db.reviewLog.findMany({
      where: { userId, context: "solo" },
      orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
      take: reviewWindow,
      select: { grade: true, item: { select: { type: true } } },
    }),
  ]);
  const itemIds = items.map((item) => item.id);
  const [cards, pending] = await Promise.all([
    db.cardState.findMany({
      where: { userId, itemId: { in: itemIds } },
      select: {
        itemId: true,
        schedulerVersion: true,
        state: true,
        dueAt: true,
        misconceptionUntil: true,
      },
    }),
    db.reviewPending.findMany({
      where: { userId, itemId: { in: itemIds } },
      select: { itemId: true },
    }),
  ]);
  const cardOf = new Map(cards.map((card) => [card.itemId, card]));
  const pendingIds = new Set(pending.map((row) => row.itemId));

  const seen: SimItem[] = [];
  const fresh: (SimItem & { order: number[]; sourceId: string })[] = [];
  for (const item of items) {
    if (pendingIds.has(item.id)) continue;
    const card = cardOf.get(item.id);
    if (card === undefined) {
      fresh.push({
        itemId: item.id,
        schedulerVersion: null,
        state: null,
        dueAt: null,
        sourceId: item.sourceChunk.sourceId,
        order: [
          -item.sourceChunk.source.createdAt.getTime(),
          item.sourceChunk.createdAt.getTime(),
          item.createdAt.getTime(),
        ],
      });
      continue;
    }
    seen.push({
      itemId: item.id,
      schedulerVersion: card.schedulerVersion,
      // Validated by the scheduler that reads it, as in loadPools().
      state: card.state as unknown as CardState,
      dueAt: effectiveDueAt(card),
    });
  }
  seen.sort((a, b) => compareIds(a.itemId, b.itemId));
  // The new pool's order (06 §2): newest source first, then reading order within it.
  fresh.sort((a, b) => {
    const [sa, ca, ia] = a.order as [number, number, number];
    const [sb, cb, ib] = b.order as [number, number, number];
    return (
      sa - sb ||
      compareIds(a.sourceId, b.sourceId) ||
      ca - cb ||
      ia - ib ||
      compareIds(a.itemId, b.itemId)
    );
  });

  const recentTypes = recent.slice(0, deps.queue.costWindow).map((row) => row.item.type);
  const types = [...new Set<ItemType>([...deps.queue.servedTypes, ...recentTypes])].sort();
  const medians = await Promise.all(
    types.map((itemType) =>
      deps.medians.medianMs({ userId, itemType, excludeReviewId: NO_REVIEW_ID, now }),
    ),
  );
  const model = costModel(
    Object.fromEntries(types.map((type, index) => [type, medians[index] ?? null])),
    deps.queue,
  );
  const avgCost = avgCostSec(recentTypes, model, deps.queue);

  return {
    exam,
    now,
    today: localDateOf(now, timeZone),
    timeZone,
    items: [
      ...seen,
      ...fresh.map(({ itemId, schedulerVersion, state, dueAt }) => ({
        itemId,
        schedulerVersion,
        state,
        dueAt,
      })),
    ],
    registry: deps.registry,
    slotsPerDay: slotsFor(budgetSec, avgCost),
    avgCostSec: avgCost,
    recentGrades: recent.slice(0, deps.exam.lapseWindow).map((row) => row.grade),
  };
}
