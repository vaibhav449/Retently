import { describe, expect, it } from "vitest";
import {
  EXAM_HEADLINE_TEMPLATES,
  type ExamForecast,
  examForecastSchema,
  examHeadlineSchema,
  examInputSchema,
  examUpdateSchema,
  renderExamHeadline,
  topicKeySchema,
} from "./exam";
import * as fixtures from "./fixtures";

const forecasts: [string, ExamForecast][] = [
  ["on_track", fixtures.examForecastOnTrackFixture],
  ["tight", fixtures.examForecastTightFixture],
  ["behind", fixtures.examForecastBehindFixture],
  ["infeasible", fixtures.examForecastInfeasibleFixture],
  ["exam_passed", fixtures.examForecastPassedFixture],
  ["no_items", fixtures.examForecastNoItemsFixture],
];

describe("exam forecast fixtures (EA5)", () => {
  it("cover every status, once each", () => {
    expect(forecasts.map(([status]) => status).sort()).toEqual(
      Object.keys(EXAM_HEADLINE_TEMPLATES).sort(),
    );
  });

  it.each(forecasts)("%s: the headline carries the forecast's status", (status, forecast) => {
    expect(forecast.status).toBe(status);
    expect(forecast.headline.status).toBe(status);
  });

  it.each(forecasts)("%s: the histograms count every question", (_status, forecast) => {
    const sum = (buckets: number[]) => buckets.reduce((a, b) => a + b, 0);
    expect(sum(forecast.if_nothing_more.histogram)).toBe(forecast.items.total);
    expect(sum(forecast.plan.histogram)).toBe(forecast.items.total);
    expect(forecast.items.seen + forecast.items.unseen).toBe(forecast.items.total);
  });
});

describe("renderExamHeadline (07-exam-mode.md §7)", () => {
  it("fills every template, with the date as '3 December'", () => {
    const sentences = forecasts.map(([, forecast]) => renderExamHeadline(forecast.headline));
    expect(sentences).toEqual([
      "On track: at your pace, 100/100 items should be at 90% on 3 December.",
      "Tight: you need ~10/day; plan for 12 to allow for mistakes.",
      "Behind: at 5/day only 72/100 reach 90%. 6 min a day gets you there.",
      "Not enough time: at best 60/100 items can reach 90% by 20 November.",
      "This exam was on 2 November.",
      "No questions cover this exam yet. Generate questions from its notes first.",
    ]);
    for (const sentence of sentences) expect(sentence).not.toMatch(/[{}]/);
  });
});

describe("headline inputs", () => {
  it("are tied to the status: a tight headline cannot carry an on-track one's values", () => {
    const mixed = { status: "tight", n: 1, total: 2, target_pct: 90, date: "2026-12-03" };
    expect(examHeadlineSchema.safeParse(mixed).success).toBe(false);
    const missing = { status: "behind", slots: 5, n: 72, total: 100, target_pct: 90 };
    expect(examHeadlineSchema.safeParse(missing).success).toBe(false);
  });

  it("refuses a forecast whose plan histogram is not 10 buckets", () => {
    const fixture = fixtures.examForecastOnTrackFixture;
    const short = { ...fixture, plan: { ...fixture.plan, histogram: [100] } };
    expect(examForecastSchema.safeParse(short).success).toBe(false);
  });
});

describe("exam input", () => {
  const input = fixtures.examInputFixture;

  it("takes topic keys of the form src:<uuid> only", () => {
    expect(topicKeySchema.safeParse("src:6b1f0c2e-4d3a-4f8e-9a1b-2c3d4e5f6a7b").success).toBe(true);
    for (const key of ["source:6b1f0c2e-4d3a-4f8e-9a1b-2c3d4e5f6a7b", "src:abc", "6b1f0c2e"]) {
      expect(topicKeySchema.safeParse(key).success).toBe(false);
    }
  });

  it("refuses an empty scope, a target outside 0.8–0.97, a bad date and unknown fields", () => {
    const bad = [
      { ...input, topic_keys: [] },
      { ...input, target_retention: 0.79 },
      { ...input, target_retention: 0.98 },
      { ...input, target_retention: Number.NaN },
      { ...input, exam_date: "2026-02-30" },
      { ...input, exam_date: "3 December" },
      { ...input, topic_ids: input.topic_keys },
    ];
    for (const value of bad) expect(examInputSchema.safeParse(value).success).toBe(false);
  });

  it("makes the target optional (default 0.9 on the server)", () => {
    const withoutTarget = { exam_date: input.exam_date, topic_keys: input.topic_keys };
    expect(examInputSchema.safeParse(withoutTarget).success).toBe(true);
  });

  it("refuses an update that changes nothing", () => {
    expect(examUpdateSchema.safeParse({}).success).toBe(false);
    expect(examUpdateSchema.safeParse({ exam_date: "2026-12-10" }).success).toBe(true);
  });
});
