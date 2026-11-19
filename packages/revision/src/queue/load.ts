import type { ItemType } from "@repo/contracts";
import { type Database, itemsReadableBy } from "@repo/db";
import type { CardState } from "@repo/scheduler";
import type { QueueConfig } from "../config";
import type { LatencyMedianSource } from "../grading/latency";
import { type Candidate, isDueToday, topicKeyOf } from "./features";

/** The tables loadPools() reads. */
export type PoolReader = Pick<
  Database,
  "cardState" | "chunk" | "item" | "reviewLog" | "reviewPending" | "source"
>;

/** Everything one plan is built from, for one user at one instant (06-queue-ranker.md §2). */
export interface Pools {
  /** Every seen, live, readable card of any type: the input of topic weakness (QD-10). */
  seen: Candidate[];
  /** Old pool: seen, servable, not pending, due today or with an open misconception. */
  old: Candidate[];
  /** New pool: readable, live, servable, never reviewed, not pending; at most cfg.newPoolLimit. */
  fresh: Candidate[];
  /** Item types of the newest solo reviews, at most cfg.costWindow. */
  recentTypes: ItemType[];
  soloReviewCount: number;
  /** The user's latency median per item type that may be planned or was recently reviewed. */
  mediansMs: Partial<Record<ItemType, number | null>>;
}

/**
 * There is no review being graded when the queue asks for a median; no review_log id is all
 * zeros, so excluding this one excludes nothing.
 */
const NO_REVIEW_ID = "00000000-0000-0000-0000-000000000000";

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The candidate pools of 06 §2. Flat Prisma queries, joined in memory (QD-14): the user's card_state
 * rows (one query for all seen cards), their readable live items, and those items' chunks and
 * sources (for topic keys and the new-pool order), run in parallel with the pending items, the
 * recent review types and the solo review count; then the latency medians through `medians`
 * (QD-8). Nested selects and relation order-bys were measured and are several times slower on
 * 10 000 cards. Access is itemsReadableBy() everywhere (QD-1). No cache.
 */
export async function loadPools(
  db: PoolReader,
  userId: string,
  at: { now: Date; cutoff: Date },
  deps: { medians: LatencyMedianSource; cfg: QueueConfig },
): Promise<Pools> {
  const { cfg } = deps;
  const readable = itemsReadableBy(userId);

  const [cards, items, chunks, sources, pending, recent, soloReviewCount] = await Promise.all([
    db.cardState.findMany({
      where: { userId },
      select: {
        itemId: true,
        schedulerVersion: true,
        state: true,
        dueAt: true,
        misconceptionUntil: true,
      },
    }),
    db.item.findMany({
      where: { ...readable, retiredAt: null },
      select: { id: true, type: true, sourceChunkId: true, createdAt: true },
    }),
    // The chunks and sources of readable items: the same access rule, one level up.
    db.chunk.findMany({
      where: readable.sourceChunk,
      select: { id: true, sourceId: true, createdAt: true },
    }),
    db.source.findMany({
      where: readable.sourceChunk.source,
      select: { id: true, createdAt: true },
    }),
    db.reviewPending.findMany({ where: { userId }, select: { itemId: true } }),
    db.reviewLog.findMany({
      where: { userId, context: "solo" },
      orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
      take: cfg.costWindow,
      select: { item: { select: { type: true } } },
    }),
    db.reviewLog.count({ where: { userId, context: "solo" } }),
  ]);

  const chunkOf = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const sourceCreatedAt = new Map(sources.map((source) => [source.id, source.createdAt]));
  const pendingIds = new Set(pending.map((row) => row.itemId));
  const served = new Set<ItemType>(cfg.servedTypes);

  /** A readable, live item with its chunk: everything else is not in the user's bank. */
  const bank = new Map<
    string,
    { type: ItemType; createdAt: Date; chunk: (typeof chunks)[number] }
  >();
  for (const item of items) {
    const chunk = chunkOf.get(item.sourceChunkId);
    if (chunk !== undefined)
      bank.set(item.id, { type: item.type, createdAt: item.createdAt, chunk });
  }

  const seen: Candidate[] = [];
  for (const card of cards.sort((a, b) => compareIds(a.itemId, b.itemId))) {
    const item = bank.get(card.itemId);
    if (item === undefined) continue;
    seen.push({
      itemId: card.itemId,
      type: item.type,
      topicKey: topicKeyOf(item.chunk.sourceId),
      card: {
        schedulerVersion: card.schedulerVersion,
        // Validated by the scheduler that reads it: every Scheduler method parses its own state.
        state: card.state as unknown as CardState,
        dueAt: card.dueAt,
        misconceptionUntil: card.misconceptionUntil,
      },
    });
  }
  const old = seen.filter(
    (candidate) =>
      served.has(candidate.type) &&
      !pendingIds.has(candidate.itemId) &&
      candidate.card !== null &&
      isDueToday(candidate.card, at.cutoff),
  );

  // Newest source first, then reading order within it (06 §2); topics and chunk positions do not
  // exist yet, so creation times stand in for them.
  const hasCard = new Set(cards.map((card) => card.itemId));
  const fresh = [...bank]
    .filter(([id, item]) => served.has(item.type) && !hasCard.has(id) && !pendingIds.has(id))
    .map(([id, item]) => ({
      id,
      item,
      sourceAt: sourceCreatedAt.get(item.chunk.sourceId)?.getTime() ?? 0,
    }))
    .sort(
      (a, b) =>
        b.sourceAt - a.sourceAt ||
        compareIds(a.item.chunk.sourceId, b.item.chunk.sourceId) ||
        a.item.chunk.createdAt.getTime() - b.item.chunk.createdAt.getTime() ||
        a.item.createdAt.getTime() - b.item.createdAt.getTime() ||
        compareIds(a.id, b.id),
    )
    .slice(0, cfg.newPoolLimit)
    .map(({ id, item }): Candidate => ({
      itemId: id,
      type: item.type,
      topicKey: topicKeyOf(item.chunk.sourceId),
      card: null,
    }));
  const recentTypes = recent.map((row) => row.item.type);

  const types = [...new Set<ItemType>([...cfg.servedTypes, ...recentTypes])].sort();
  const medians = await Promise.all(
    types.map((itemType) =>
      deps.medians.medianMs({ userId, itemType, excludeReviewId: NO_REVIEW_ID, now: at.now }),
    ),
  );
  const mediansMs = Object.fromEntries(types.map((type, index) => [type, medians[index] ?? null]));

  return { seen, old, fresh, recentTypes, soloReviewCount, mediansMs };
}
