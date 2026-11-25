import { intervalModifier, type SchedulerRegistry } from "@repo/scheduler";
import type { SeenCard } from "../queue/features";

/**
 * R_exam (07-exam-mode.md §2): the predicted recall at `examAt`, through the scheduler that wrote
 * the card; 0 for an item never reviewed. It depends only on the card's state (stability and last
 * review) and `examAt`, so it never drifts while no review happens (D-04, 07 §3.2). Pure.
 */
export function rExam(card: SeenCard | null, examAt: Date, registry: SchedulerRegistry): number {
  if (card === null) return 0;
  return registry.get(card.schedulerVersion).retrievability(card.state, examAt);
}

/** shortfall_norm = max(0, T − R_exam) / T ∈ [0, 1] (07 §2). Pure. */
export function shortfallNorm(recall: number, target: number): number {
  return Math.max(0, target - recall) / target;
}

/**
 * The stability an item needs to reach `target` after `elapsedDays` days without a review:
 * S ≥ t / m(T) (07 §2's closed form, fsrs6-v1's curve). At T = 0.9 that is S ≥ t. Pure.
 */
export function requiredStability(elapsedDays: number, target: number): number {
  return elapsedDays / intervalModifier(target);
}

/**
 * How much more stability each target needs than 0.9 does, for the setup screen's trade-off line
 * (07 §2, EM-6): 1 / m(T) for T from `from` to `to` in steps of 0.01, so the client needs no
 * scheduler. At 0.95 it is ≈ 2.5. Pure.
 */
export function stabilityMultipliers(
  from: number,
  to: number,
): { target: number; multiplier: number }[] {
  const rows: { target: number; multiplier: number }[] = [];
  for (
    let hundredths = Math.round(from * 100);
    hundredths <= Math.round(to * 100);
    hundredths += 1
  ) {
    const target = hundredths / 100;
    rows.push({ target, multiplier: 1 / intervalModifier(target) });
  }
  return rows;
}
