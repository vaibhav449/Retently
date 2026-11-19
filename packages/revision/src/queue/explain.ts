import type { ReviewCategory } from "@repo/contracts";
import type { QueueConfig } from "../config";
import type { Features } from "./features";

export type ReasonKind = "misconception" | "overdue" | "exam" | "weakness" | "coverage";

/** The tie order: an equal contribution goes to the earlier kind. */
const KINDS: readonly ReasonKind[] = ["misconception", "overdue", "exam", "weakness", "coverage"];

export interface ReasonContext {
  weights: QueueConfig["weights"];
  /** For the coverage message: the item's source. */
  sourceTitle?: string;
  /** For the overdue message: days since the card's due date. */
  overdueDays?: number;
}

/**
 * "Why am I seeing this?" (06-queue-ranker.md §10): the kind with the largest weighted contribution
 * to the entry's priority, ties broken misconception > overdue > exam > weakness > coverage, and its
 * message. With no contribution at all, the entry's category decides. Pure.
 */
export function reasonFor(
  entry: { category: ReviewCategory; features: Features },
  ctx: ReasonContext,
): { kind: ReasonKind; message: string } {
  const w = ctx.weights;
  const f = entry.features;
  const contributions: Record<ReasonKind, number> = {
    misconception: w.misconception * f.mis,
    overdue: w.overdue * f.overdue,
    exam: w.exam * f.exam,
    weakness: w.weakness * f.weak,
    coverage: w.coverage * f.cov,
  };
  let kind: ReasonKind = fallbackKind(entry.category);
  let best = 0;
  for (const candidate of KINDS) {
    if (contributions[candidate] > best) {
      best = contributions[candidate];
      kind = candidate;
    }
  }
  return { kind, message: messageFor(kind, ctx) };
}

function fallbackKind(category: ReviewCategory): ReasonKind {
  if (category === "misconception") return "misconception";
  return category === "new" ? "coverage" : "overdue";
}

function messageFor(kind: ReasonKind, ctx: ReasonContext): string {
  switch (kind) {
    case "misconception":
      return "You were sure about this and got it wrong — let's check it again.";
    case "overdue": {
      const days = Math.round(ctx.overdueDays ?? 0);
      const when = days <= 0 ? "Due today" : days === 1 ? "Due 1 day ago" : `Due ${days} days ago`;
      return `${when}; your memory of this is fading.`;
    }
    case "exam":
      return "This is on your upcoming exam.";
    case "weakness":
      return "One of your weaker topics.";
    case "coverage":
      return ctx.sourceTitle
        ? `New question from ${ctx.sourceTitle}.`
        : "New question from your notes.";
  }
}
