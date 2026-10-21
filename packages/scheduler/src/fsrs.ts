import { default_w, FSRSAlgorithm } from "ts-fsrs";
import { fsrsCardStateSchema } from "./schema";
import { addDays, daysBetween } from "./time";
import type { CardState, FsrsCardState, Grade, Scheduler } from "./types";

/**
 * What defines fsrs6-v1 (04-scheduler.md §5.6). Changing any of it is a new scheduler version and
 * a card_state rebuild from review_log, never an edit in place.
 */
const FSRS6_V1 = {
  w: default_w, // ts-fsrs 5.4.2, pinned exactly in package.json
  request_retention: 0.9,
  maximum_interval: 365,
  enable_fuzz: false, // fuzz randomises intervals, so a replay would diverge
  enable_short_term: false, // the unit of scheduling is the day
};

const algorithm = new FSRSAlgorithm(FSRS6_V1);

interface Memory {
  difficulty: number;
  stability: number;
}

/**
 * FSRS-6 through ts-fsrs's maths primitives, with time measured in fractional days. The library's
 * high-level `fsrs().next()` counts UTC calendar days instead, so a review at 22:00 IST followed by
 * one at 06:00 IST would be a day apart (04-scheduler.md §5.1, decision D-02).
 */
export const fsrs6V1: Scheduler = {
  version: "fsrs6-v1",

  initial(): FsrsCardState {
    return {
      kind: "fsrs",
      last_review_at: null,
      due_at: null,
      reps: 0,
      lapses: 0,
      difficulty: 0,
      stability: 0,
      scheduled_days: 0,
    };
  },

  next(state: CardState, grade: Grade, now: Date): FsrsCardState {
    const card = asFsrs(state);
    const lastReviewAt = card.last_review_at === null ? null : new Date(card.last_review_at);
    const t = lastReviewAt === null ? 0 : Math.max(0, daysBetween(now, lastReviewAt));
    const memory: Memory | null =
      lastReviewAt === null ? null : { difficulty: card.difficulty, stability: card.stability };
    const r = memory === null ? undefined : algorithm.forgetting_curve(t, memory.stability);

    // All four outcomes, because the ordering rule needs the other grades' intervals.
    const outcome = (g: Grade): Memory => algorithm.next_state(memory, t, g, r);
    const memories: Record<Grade, Memory> = {
      1: outcome(1),
      2: outcome(2),
      3: outcome(3),
      4: outcome(4),
    };
    const raw = (g: Grade) => algorithm.next_interval(memories[g].stability, t);

    // The library's ordering rule: Again ≤ Hard < Good < Easy, each at least a day apart.
    const again = Math.min(raw(1), raw(2));
    const hard = Math.max(raw(2), again + 1);
    const good = Math.max(raw(3), hard + 1);
    const easy = Math.max(raw(4), good + 1);
    const interval: Record<Grade, number> = { 1: again, 2: hard, 3: good, 4: easy };

    return {
      kind: "fsrs",
      last_review_at: now.toISOString(),
      due_at: addDays(now, interval[grade]).toISOString(),
      reps: card.reps + 1,
      // A first-review Again is not a lapse: nothing had been learned yet.
      lapses: card.lapses + (grade === 1 && lastReviewAt !== null ? 1 : 0),
      difficulty: memories[grade].difficulty,
      stability: memories[grade].stability,
      scheduled_days: interval[grade],
    };
  },

  retrievability(state: CardState, at: Date): number {
    const card = asFsrs(state);
    if (card.last_review_at === null) return 0;
    const t = Math.max(0, daysBetween(at, new Date(card.last_review_at)));
    return algorithm.forgetting_curve(t, card.stability);
  },

  stabilityDays(state: CardState): number {
    return asFsrs(state).stability;
  },
};

// A state is advanced only by the scheduler that wrote it.
function asFsrs(state: CardState): FsrsCardState {
  if (state.kind !== "fsrs") {
    throw new Error(`fsrs6-v1 got a "${state.kind}" card state; use the scheduler that wrote it`);
  }
  return fsrsCardStateSchema.parse(state);
}
