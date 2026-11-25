import {
  type ReviewCategory,
  type ReviewSessionView,
  reviewSessionViewSchema,
  type SessionProgress,
} from "@repo/contracts";
import { type Database, itemsReadableBy } from "@repo/db";
import type { SchedulerRegistry } from "@repo/scheduler";
import { type QueueConfig, SESSION_TRANSACTION_OPTIONS } from "../config";
import { type LatencyMedianSource, latencyMediansFromDb } from "../grading/latency";
import type { GradingConfig } from "../grading/mapping";
import { effectiveDueAt } from "../misconception";
import type { Clock } from "../record/recordReview";
import { userRevisionSettings } from "../settings";
import { localDateOf, startOfNextLocalDay } from "../time";
import { loadPools } from "./load";
import {
  examDuePool,
  type PlanEntry,
  planFor,
  type PlanMeta,
  planMeta,
  planMetaSchema,
  planSchema,
} from "./plan";

export interface SessionDeps {
  db: Database;
  clock: Clock;
  registry: SchedulerRegistry;
  /** Its latency settings drive the default medians source. */
  grading: GradingConfig;
  queue: QueueConfig;
  /**
   * Where the cost model's medians come from (QD-8). Defaults to an uncached
   * latencyMediansFromDb(db, grading.latency); the web app passes its cached one.
   */
  medians?: LatencyMedianSource;
}

/** A review_sessions row, its JSON validated (QD-15). */
export interface StoredSession {
  id: string;
  userId: string;
  /** "YYYY-MM-DD" in the user's zone. */
  localDate: string;
  budgetSec: number;
  plan: PlanEntry[];
  meta: PlanMeta;
  extendedCount: number;
  /** From the injected clock (QD-5): answers at or after it count as done. */
  createdAt: Date;
}

/** Today's session and the facts of "today" it was looked up with. */
export interface TodaySession {
  session: StoredSession;
  now: Date;
  /** The start of the user's next local day. */
  cutoff: Date;
  /** The user's budget now (revision_settings); an extension uses it (Q-E20). */
  budgetSec: number;
  /** The user's zone, which places each exam's exam_at. */
  timeZone: string;
}

type SessionRow = Awaited<ReturnType<Database["reviewSession"]["findUniqueOrThrow"]>>;
type SessionReader = Pick<Database, "reviewSession">;

function parseSession(row: SessionRow): StoredSession {
  return {
    id: row.id,
    userId: row.userId,
    localDate: row.localDate.toISOString().slice(0, 10),
    budgetSec: row.budgetSec,
    plan: planSchema.parse(row.plan),
    meta: planMetaSchema.parse(row.meta),
    extendedCount: row.extendedCount,
    createdAt: row.createdAt,
  };
}

/** review_sessions.local_date is a DATE; Prisma reads and writes it as UTC midnight. */
function dateColumn(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

async function findSession(
  db: SessionReader,
  userId: string,
  localDate: string,
): Promise<StoredSession | null> {
  const row = await db.reviewSession.findUnique({
    where: { userId_localDate: { userId, localDate: dateColumn(localDate) } },
  });
  return row === null ? null : parseSession(row);
}

/**
 * One builder or extender at a time per (user, local day) (QD-3), like lockCard(). Released when
 * the surrounding transaction ends.
 */
async function lockSession(
  tx: Pick<Database, "$executeRaw">,
  userId: string,
  localDate: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`session:${userId}:${localDate}`}))`;
}

function mediansOf(deps: SessionDeps): LatencyMedianSource {
  return deps.medians ?? latencyMediansFromDb(deps.db, deps.grading.latency);
}

/**
 * The pools at `now`, read through the connection pool: called under the session lock, its
 * parallel queries would otherwise queue up on the transaction's one connection.
 */
async function poolsAt(
  userId: string,
  at: { now: Date; cutoff: Date; timeZone: string },
  deps: SessionDeps,
) {
  return loadPools(deps.db, userId, at, { medians: mediansOf(deps), cfg: deps.queue });
}

/**
 * Get-or-create today's session (06-queue-ranker.md §8, Q6.1, Q6.5). "Today" is the local date of
 * the injected clock in the user's zone. The first call of the day builds the plan under the
 * session lock and saves it with created_at = now (QD-3, QD-5); later calls return it with one
 * read. A saved plan that is still empty is rebuilt in place (QD-4), so a user whose items are
 * generated later in the day is not stuck on "nothing".
 */
export async function getOrCreateSession(userId: string, deps: SessionDeps): Promise<TodaySession> {
  const now = deps.clock.now();
  const { timeZone, budgetSec } = await userRevisionSettings(deps.db, userId, deps.queue);
  const localDate = localDateOf(now, timeZone);
  const cutoff = startOfNextLocalDay(now, timeZone);
  const today = (session: StoredSession): TodaySession => ({
    session,
    now,
    cutoff,
    budgetSec,
    timeZone,
  });

  const existing = await findSession(deps.db, userId, localDate);
  if (existing !== null && existing.plan.length > 0) return today(existing);

  const session = await deps.db.$transaction(async (tx) => {
    await lockSession(tx, userId, localDate);
    const row = await findSession(tx, userId, localDate);
    if (row !== null && row.plan.length > 0) return row;

    const pools = await poolsAt(userId, { now, cutoff, timeZone }, deps);
    const { entries, numbers } = planFor(
      { ...pools, now, cutoff, registry: deps.registry, budgetSec, ext: 0 },
      deps.queue,
    );
    const data = {
      budgetSec,
      plan: entries,
      meta: planMeta(numbers, deps.queue, now),
      extendedCount: 0,
      createdAt: now,
    };
    const saved =
      row === null
        ? await tx.reviewSession.create({
            data: { userId, localDate: dateColumn(localDate), ...data },
          })
        : await tx.reviewSession.update({ where: { id: row.id }, data });
    return parseSession(saved);
  }, SESSION_TRANSACTION_OPTIONS);
  return today(session);
}

type EntryState = "done" | "open" | "skipped";

/**
 * Where each plan entry stands now (06 §8, Q6.2): done (a solo answer since the session was
 * created), open (live, readable, servable, not pending, and still due today, new, or planned as
 * exam-due: EM-10, since those are by definition not due today), or skipped.
 * Re-validated lazily on every call, so an item answered elsewhere, retired, made unreadable or
 * pending drops out silently (Q-E13–Q-E15).
 */
async function entryStates(
  db: Database,
  userId: string,
  today: TodaySession,
  cfg: QueueConfig,
): Promise<EntryState[]> {
  const { plan, createdAt } = today.session;
  if (plan.length === 0) return [];
  const ids = plan.map((entry) => entry.item_id);
  const [answered, live, pending, cards] = await Promise.all([
    db.reviewLog.findMany({
      where: { userId, context: "solo", itemId: { in: ids }, reviewedAt: { gte: createdAt } },
      select: { itemId: true },
      distinct: ["itemId"],
    }),
    db.item.findMany({
      where: {
        id: { in: ids },
        ...itemsReadableBy(userId),
        retiredAt: null,
        type: { in: [...cfg.servedTypes] },
      },
      select: { id: true },
    }),
    db.reviewPending.findMany({ where: { userId, itemId: { in: ids } }, select: { itemId: true } }),
    db.cardState.findMany({
      where: { userId, itemId: { in: ids } },
      select: { itemId: true, dueAt: true, misconceptionUntil: true },
    }),
  ]);
  const done = new Set(answered.map((row) => row.itemId));
  const liveIds = new Set(live.map((row) => row.id));
  const pendingIds = new Set(pending.map((row) => row.itemId));
  const cardOf = new Map(cards.map((card) => [card.itemId, card]));

  return plan.map((entry) => {
    if (done.has(entry.item_id)) return "done";
    if (!liveIds.has(entry.item_id) || pendingIds.has(entry.item_id)) return "skipped";
    if (entry.exam_due === true) return "open";
    const card = cardOf.get(entry.item_id);
    if (card === undefined) return "open";
    return effectiveDueAt(card).getTime() < today.cutoff.getTime() ? "open" : "skipped";
  });
}

/** done = answered entries; planned = done + open ones, so skipped entries drop out (QD-6). */
function progressOf(states: readonly EntryState[]): SessionProgress {
  const done = states.filter((state) => state === "done").length;
  const open = states.filter((state) => state === "open").length;
  return { done, planned: done + open };
}

/**
 * True when the pools, recomputed now, hold a candidate that is not in the plan yet: due, new, or
 * exam-due under the exams as they are now (ER3.5).
 */
async function canExtend(userId: string, today: TodaySession, deps: SessionDeps): Promise<boolean> {
  const inPlan = new Set(today.session.plan.map((entry) => entry.item_id));
  const pools = await poolsAt(userId, today, deps);
  const examDue = examDuePool({ ...pools, now: today.now, registry: deps.registry });
  return [...pools.old, ...examDue, ...pools.fresh].some(
    (candidate) => !inPlan.has(candidate.itemId),
  );
}

export type NextInSession =
  | {
      kind: "entry";
      sessionId: string;
      /** The session's local date, for the why line's "your exam is in 5 days". */
      localDate: string;
      entry: PlanEntry;
      progress: SessionProgress;
    }
  | { kind: "done"; canExtend: boolean }
  | { kind: "nothing" };

/**
 * GET /next's choice (06 §8, Q6.2, Q6.3): the first open entry of today's plan, which is created
 * if needed (QD-2); else "done" when the plan has entries, with can_extend; else "nothing" (an
 * empty plan is only kept while nothing at all can be planned).
 */
export async function nextInSession(userId: string, deps: SessionDeps): Promise<NextInSession> {
  const today = await getOrCreateSession(userId, deps);
  const { plan } = today.session;
  if (plan.length === 0) return { kind: "nothing" };

  const states = await entryStates(deps.db, userId, today, deps.queue);
  const index = states.indexOf("open");
  const entry = plan[index];
  if (entry !== undefined) {
    return {
      kind: "entry",
      sessionId: today.session.id,
      localDate: today.session.localDate,
      entry,
      progress: progressOf(states),
    };
  }
  return { kind: "done", canExtend: await canExtend(userId, today, deps) };
}

/**
 * "Study more" (06 §8, Q6.4, QD-12): the same selection over candidates not in the plan, with the
 * new-item cap lifted and N from the user's budget now (Q-E20), appended to the plan and
 * interleaved on from its last topic; extended_count + 1 and one more meta.extensions record.
 * The exams are read as they are now, so one created since the morning counts from here on, and
 * meta.exam_ids becomes the union (ER3.5, E12).
 * Serialised with building by the session lock, so two concurrent extends never add an item twice
 * (Q-E19). With nothing to add, the session is unchanged.
 */
export async function extendSession(userId: string, deps: SessionDeps): Promise<ReviewSessionView> {
  const today = await getOrCreateSession(userId, deps);
  const { now, cutoff, budgetSec, timeZone } = today;
  const { localDate } = today.session;

  await deps.db.$transaction(async (tx) => {
    await lockSession(tx, userId, localDate);
    const row = await findSession(tx, userId, localDate);
    if (row === null) return;

    const pools = await poolsAt(userId, { now, cutoff, timeZone }, deps);
    const ext = row.extendedCount + 1;
    const { entries, numbers } = planFor(
      {
        ...pools,
        now,
        cutoff,
        registry: deps.registry,
        budgetSec,
        ext,
        exclude: new Set(row.plan.map((entry) => entry.item_id)),
        lastTopic: row.plan.at(-1)?.topic_key ?? null,
      },
      deps.queue,
    );
    if (entries.length === 0) return;

    const meta: PlanMeta = {
      ...row.meta,
      exam_ids: [...new Set([...row.meta.exam_ids, ...numbers.examIds])].sort(),
      extensions: [
        ...row.meta.extensions,
        {
          at: now.toISOString(),
          N: numbers.N,
          added: entries.length,
          backlog: numbers.backlog,
          exam_ids: numbers.examIds,
        },
      ],
    };
    await tx.reviewSession.update({
      where: { id: row.id },
      data: { plan: [...row.plan, ...entries], meta, extendedCount: ext },
    });
  }, SESSION_TRANSACTION_OPTIONS);
  return sessionView(userId, deps);
}

/**
 * POST /session's view of today's session (06 §8, §4.6 of the plan): progress over the entries
 * still in play, the remaining time as the planned cost of the open ones, and the composition of
 * done + open entries by category. Creates the session if needed.
 */
export async function sessionView(userId: string, deps: SessionDeps): Promise<ReviewSessionView> {
  const today = await getOrCreateSession(userId, deps);
  const { session } = today;
  const states = await entryStates(deps.db, userId, today, deps.queue);

  const composition: Record<ReviewCategory, number> = { review: 0, misconception: 0, new: 0 };
  let remainingSec = 0;
  session.plan.forEach((entry, index) => {
    const state = states[index];
    if (state === "skipped") return;
    composition[entry.category] += 1;
    if (state === "open") remainingSec += entry.cost_sec;
  });

  return reviewSessionViewSchema.parse({
    session_id: session.id,
    local_date: session.localDate,
    budget_sec: session.budgetSec,
    remaining_sec: Math.round(remainingSec),
    ...progressOf(states),
    composition,
    exam_ids: session.meta.exam_ids,
    // The latest plan's: the first one's, or the last extension's (QD-13).
    backlog: session.meta.extensions.at(-1)?.backlog ?? session.meta.backlog,
  });
}
