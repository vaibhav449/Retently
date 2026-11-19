import { describe, expect, it } from "vitest";
import { DEFAULT_QUEUE } from "../config";
import { NO_FEATURES } from "../test/queue";
import type { Features } from "./features";
import { reasonFor } from "./explain";

const weights = DEFAULT_QUEUE.weights;
const reason = (
  features: Partial<Features>,
  category: "review" | "misconception" | "new" = "review",
  extra: { sourceTitle?: string; overdueDays?: number } = {},
) => reasonFor({ category, features: { ...NO_FEATURES, ...features } }, { weights, ...extra });

describe("reasonFor (06 §10)", () => {
  it("picks the largest weighted contribution, with the spec's message", () => {
    expect(reason({ mis: 1, weak: 0.6 }, "misconception")).toEqual({
      kind: "misconception",
      message: "You were sure about this and got it wrong — let's check it again.",
    });
    expect(reason({ overdue: 2, weak: 0.3 }, "review", { overdueDays: 3 })).toEqual({
      kind: "overdue",
      message: "Due 3 days ago; your memory of this is fading.",
    });
    expect(reason({ overdue: 0.1, weak: 0.4 }).kind).toBe("weakness");
    expect(reason({ weak: 0.4 }).message).toBe("One of your weaker topics.");
    expect(reason({ cov: 1 }, "new", { sourceTitle: "Biology" })).toEqual({
      kind: "coverage",
      message: "New question from Biology.",
    });
    // A weak topic (0.6 × 1) beats the coverage term (0.5) of a new item.
    expect(reason({ cov: 1, weak: 0.6 }, "new").kind).toBe("weakness");
  });

  it("weights the exam term by 2", () => {
    expect(reason({ exam: 0.6, overdue: 1.1 }).kind).toBe("exam");
    expect(reason({ exam: 0.5, overdue: 1.1 }).kind).toBe("overdue");
  });

  it("breaks ties misconception > overdue > exam > weakness > coverage", () => {
    expect(reason({ mis: 1, overdue: 5 }).kind).toBe("misconception");
    expect(reason({ overdue: 0.5, weak: 0.5 }).kind).toBe("overdue");
    expect(reason({ exam: 0.25, weak: 0.5 }).kind).toBe("exam");
    expect(reason({ weak: 0.5, cov: 1 }).kind).toBe("weakness");
  });

  it("falls back to the category when nothing contributes", () => {
    expect(reason({}, "review").message).toBe("Due today; your memory of this is fading.");
    expect(reason({}, "new").message).toBe("New question from your notes.");
    expect(reason({}, "misconception").kind).toBe("misconception");
  });

  it("says one day in the singular", () => {
    expect(reason({ overdue: 1 }, "review", { overdueDays: 1.2 }).message).toBe(
      "Due 1 day ago; your memory of this is fading.",
    );
  });
});
