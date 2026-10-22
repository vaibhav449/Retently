import { sm2CardStateSchema } from "./schema";
import { addDays, daysBetween } from "./time";
import type { CardState, Grade, Scheduler, Sm2CardState } from "./types";

const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
// Not in the 1987 algorithm, where intervals grow without limit: after about 20 successes the due
// date passes year 9999. Capped like fsrs6-v1, so the two compare on the same semester scale.
const MAX_INTERVAL_DAYS = 365;

/** Grade → SM-2 quality (04-scheduler.md §7.1). */
const QUALITY: Record<Grade, number> = { 1: 1, 2: 3, 3: 4, 4: 5 };

/**
 * sm2-v1: the 1987 SuperMemo-2 algorithm, faithful rather than improved (04-scheduler.md §7). It
 * exists so the evaluation can replay one review_log through FSRS and SM-2 and compare them.
 * SM-2 gives an interval, not a probability, so R is a proxy: 0.9 ^ (t / interval), treating the
 * interval as the time to 90%, like FSRS's S.
 */
export const sm2V1: Scheduler = {
  version: "sm2-v1",

  initial(): Sm2CardState {
    return {
      kind: "sm2",
      last_review_at: null,
      due_at: null,
      reps: 0,
      lapses: 0,
      repetition: 0,
      interval: 0,
      ease: INITIAL_EASE,
    };
  },

  next(state: CardState, grade: Grade, now: Date): Sm2CardState {
    const card = asSm2(state);
    const q = QUALITY[grade];
    const reviewedBefore = card.last_review_at !== null;

    let repetition = 0;
    let interval = 1;
    let ease = card.ease; // a miss starts over without changing ease
    if (q >= 3) {
      repetition = card.repetition + 1;
      interval = Math.min(
        MAX_INTERVAL_DAYS,
        repetition === 1 ? 1 : repetition === 2 ? 6 : Math.round(card.interval * card.ease),
      );
      ease = Math.max(MIN_EASE, card.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    }

    return {
      kind: "sm2",
      last_review_at: now.toISOString(),
      due_at: addDays(now, interval).toISOString(),
      reps: card.reps + 1,
      lapses: card.lapses + (grade === 1 && reviewedBefore ? 1 : 0),
      repetition,
      interval,
      ease,
    };
  },

  retrievability(state: CardState, at: Date): number {
    const card = asSm2(state);
    if (card.last_review_at === null) return 0;
    const t = Math.max(0, daysBetween(at, new Date(card.last_review_at)));
    return 0.9 ** (t / card.interval);
  },

  stabilityDays(state: CardState): number {
    return asSm2(state).interval;
  },
};

// A state is advanced only by the scheduler that wrote it.
function asSm2(state: CardState): Sm2CardState {
  if (state.kind !== "sm2") {
    throw new Error(`sm2-v1 got a "${state.kind}" card state; use the scheduler that wrote it`);
  }
  return sm2CardStateSchema.parse(state);
}
