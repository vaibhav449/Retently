/**
 * Sample data for every contract shape. Build against these until the real thing lands;
 * fixtures.test.ts checks each one against its schema in CI, so they can't drift.
 * Import from "@repo/contracts/fixtures" in tests and stubs, never in production code.
 */
import type { Citation } from "../citation";
import type { GenerateQuestionsQueuedResponse } from "../document";
import type { Exam, ExamForecast, ExamInput, ExamListResponse, ExamUpdate } from "../exam";
import type { ClozeItem, McqItem, ShortAnswerItem } from "../item";
import type { IngestCompletedEvent, IngestFailedEvent, IngestRequestedJob } from "../jobs";
import type { RealtimeTokenResponse } from "../realtime";
import type {
  ReviewAnswerRequest,
  ReviewAnswerResponse,
  ReviewItemView,
  ReviewNextResponse,
  ReviewSessionView,
} from "../review";
import type { WsEnvelope } from "../ws";

const NOTE_SOURCE_ID = "6b1f0c2e-4d3a-4f8e-9a1b-2c3d4e5f6a7b";
const PDF_SOURCE_ID = "7c2a1d3f-5e4b-4a9f-8b2c-3d4e5f6a7b8c";
const NOTE_CHUNK_ID = "8d3b2e4a-6f5c-4b0a-9c3d-4e5f6a7b8c9d";
const PDF_CHUNK_ID = "9e4c3f5b-7a6d-4c1b-8d4e-5f6a7b8c9d0e";

const OPTION_IDS = {
  ribosome: "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
  mitochondrion: "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e",
  golgi: "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f",
  lysosome: "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a",
};

/** Opaque to the client. The real format is decided server-side in Phase 1. */
const MCQ_PRESENTATION_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiIwMTkyZjBjNC03ZDJhLTdjM2UtOWE1MS00YjhmMGU2ZDFhMjMifQ.signature";
const SHORT_PRESENTATION_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiIwMTkyZjBjNS0xYjNlLTdkNGYtOGI2Mi01YzlmMWU3ZDJiMzQifQ.signature";

/** uuid v7 review ids, minted when each item was presented. */
const MISCONCEPTION_REVIEW_ID = "0192f0c4-7d2a-7c3e-9a51-4b8f0e6d1a23";
const SHORT_REVIEW_ID = "0192f0c5-1b3e-7d4f-8b62-5c9f1e7d2b34";
const CORRECT_REVIEW_ID = "0192f0c6-2c4f-7e5a-9c73-6d0a2f8e3c45";

export const mcqItemFixture: McqItem = {
  id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  source_chunk_id: NOTE_CHUNK_ID,
  type: "mcq",
  prompt: "Which organelle is the site of aerobic respiration?",
  answer: "Mitochondrion",
  options: [
    { id: OPTION_IDS.ribosome, text: "Ribosome" },
    { id: OPTION_IDS.mitochondrion, text: "Mitochondrion" },
    { id: OPTION_IDS.golgi, text: "Golgi apparatus" },
    { id: OPTION_IDS.lysosome, text: "Lysosome" },
  ],
  answer_option_id: OPTION_IDS.mitochondrion,
  rubric: null,
  difficulty_seed: null,
  created_at: "2026-10-18T09:00:00.000Z",
  retired_at: null,
};

export const clozeItemFixture: ClozeItem = {
  id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  source_chunk_id: PDF_CHUNK_ID,
  type: "cloze",
  prompt: "The light reactions of photosynthesis take place in the ___ membrane.",
  answer: "thylakoid",
  options: [],
  answer_option_id: null,
  rubric: null,
  difficulty_seed: null,
  created_at: "2026-10-18T09:00:00.000Z",
  retired_at: null,
};

export const shortAnswerItemFixture: ShortAnswerItem = {
  id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  source_chunk_id: NOTE_CHUNK_ID,
  type: "short_answer",
  prompt: "Why does a cell need oxygen for aerobic respiration?",
  answer: "Oxygen is the final electron acceptor in the electron transport chain.",
  options: [],
  answer_option_id: null,
  rubric:
    "Full marks: names oxygen as the final electron acceptor. Half: mentions the electron transport chain only.",
  difficulty_seed: null,
  created_at: "2026-10-18T09:00:00.000Z",
  retired_at: null,
};

export const noteCitationFixture: Citation = {
  chunk_id: NOTE_CHUNK_ID,
  source_id: NOTE_SOURCE_ID,
  source_kind: "note",
  title: "Biology — Cell structure",
  block_id: "blk_7f3a",
  snippet: "Mitochondria are the site of aerobic respiration and make most of the cell's ATP.",
};

export const pdfCitationFixture: Citation = {
  chunk_id: PDF_CHUNK_ID,
  source_id: PDF_SOURCE_ID,
  source_kind: "pdf",
  title: "NCERT Biology Class 11 — Chapter 13",
  page: 34,
  snippet: "The light reactions occur in the thylakoid membranes of the chloroplast.",
};

/** The MCQ as presented: options in a fresh order, and nothing that gives the answer away. */
export const reviewItemViewFixture: ReviewItemView = {
  presentation_token: MCQ_PRESENTATION_TOKEN,
  category: "review",
  item: {
    id: mcqItemFixture.id,
    type: "mcq",
    prompt: mcqItemFixture.prompt,
    options: [
      { id: OPTION_IDS.lysosome, text: "Lysosome" },
      { id: OPTION_IDS.mitochondrion, text: "Mitochondrion" },
      { id: OPTION_IDS.ribosome, text: "Ribosome" },
      { id: OPTION_IDS.golgi, text: "Golgi apparatus" },
    ],
  },
};

export const reviewNextOkFixture: ReviewNextResponse = {
  state: "ok",
  item: reviewItemViewFixture,
  progress: { done: 3, planned: 30 },
};

/** The same question, ranked into today's plan by an upcoming exam. */
export const reviewNextOkExamFixture: ReviewNextResponse = {
  state: "ok",
  item: reviewItemViewFixture,
  progress: { done: 3, planned: 30 },
  reason: {
    kind: "exam",
    message: "Your exam is in 5 days and your predicted recall here is 74%.",
  },
};

export const reviewNextDoneFixture: ReviewNextResponse = {
  state: "done_for_today",
  can_extend: true,
};

export const reviewNextNothingDueFixture: ReviewNextResponse = { state: "nothing_due" };

/** Sure, and wrong: Ribosome. */
export const reviewAnswerRequestFixture: ReviewAnswerRequest = {
  presentation_token: MCQ_PRESENTATION_TOKEN,
  confidence: "sure",
  response: { kind: "mcq", option_id: OPTION_IDS.ribosome },
  client_latency_ms: 4200,
};

/** A short answer. It is graded in the worker, so the response is 202 "grading". */
export const reviewAnswerTextRequestFixture: ReviewAnswerRequest = {
  presentation_token: SHORT_PRESENTATION_TOKEN,
  confidence: "think_so",
  response: { kind: "text", text: "Oxygen takes the electrons at the end of the chain." },
  client_latency_ms: 31_000,
};

/** The confident-but-wrong case: a misconception, back the next day. */
export const reviewAnswerMisconceptionFixture: ReviewAnswerResponse = {
  status: "graded",
  result: {
    review_id: MISCONCEPTION_REVIEW_ID,
    item_id: mcqItemFixture.id,
    correct: false,
    correct_answer: "Mitochondrion",
    citation: noteCitationFixture,
    grade: 1,
    retrievability_before: 0.9,
    next_due_at: "2026-10-22T09:00:00.000Z",
    scheduled_days: 1,
    misconception: {
      your_answer: "Ribosome",
      correct_answer: "Mitochondrion",
      citation: noteCitationFixture,
    },
    idempotent_replay: false,
  },
};

/** A first review, answered correctly with "Sure" and no latency history yet: Good. */
export const reviewAnswerCorrectFixture: ReviewAnswerResponse = {
  status: "graded",
  result: {
    review_id: CORRECT_REVIEW_ID,
    item_id: mcqItemFixture.id,
    correct: true,
    correct_answer: "Mitochondrion",
    citation: noteCitationFixture,
    grade: 3,
    retrievability_before: null,
    next_due_at: "2026-10-22T09:00:00.000Z",
    scheduled_days: 1,
    idempotent_replay: false,
  },
};

export const reviewAnswerGradingFixture: ReviewAnswerResponse = {
  status: "grading",
  review_id: SHORT_REVIEW_ID,
};

export const reviewSessionViewFixture: ReviewSessionView = {
  session_id: "5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c",
  local_date: "2026-10-21",
  budget_sec: 900,
  remaining_sec: 780,
  planned: 30,
  done: 3,
  composition: { review: 21, misconception: 2, new: 7 },
  exam_ids: [],
};

export const wsEnvelopeFixture: WsEnvelope = {
  type: "ingest.completed",
  payload: { source_id: PDF_SOURCE_ID, items_created: 42 },
  request_id: "req_01",
};

/** The job a "Generate questions" click publishes: the first run of that click. */
export const ingestRequestedJobFixture: IngestRequestedJob = {
  type: "ingest.requested",
  v: 1,
  source_id: NOTE_SOURCE_ID,
  version: 7,
  run: 1,
  requested_at: "2026-11-18T09:00:00.000Z",
};

/** The worker's follow-up when passages were still pending after the first run. */
export const ingestFollowUpJobFixture: IngestRequestedJob = {
  ...ingestRequestedJobFixture,
  run: 2,
};

/** The one final event of a click: 32 of the note's 45 passages have a question by now. */
export const ingestCompletedEventFixture: IngestCompletedEvent = {
  type: "ingest.completed",
  payload: {
    source_id: NOTE_SOURCE_ID,
    items_created: 12,
    chunks: 45,
    chunks_pending: 13,
    budget_exhausted: true,
  },
};

export const generateQuestionsQueuedFixture: GenerateQuestionsQueuedResponse = {
  status: "queued",
};

export const ingestFailedEventFixture: IngestFailedEvent = {
  type: "ingest.failed",
  payload: {
    source_id: NOTE_SOURCE_ID,
    error: "Questions could not be generated. Try again later.",
  },
};

export const realtimeTokenResponseFixture: RealtimeTokenResponse = {
  token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.signature",
  expires_in: 300,
};

const EXAM_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PAST_EXAM_ID = "1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
const NOTE_KEY = `src:${NOTE_SOURCE_ID}`;
const PDF_KEY = `src:${PDF_SOURCE_ID}`;
const DELETED_NOTE_KEY = "src:2c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";

/** A Biology exam in two weeks, covering one note and one PDF, at the default target. */
export const examInputFixture: ExamInput = {
  exam_date: "2026-12-03",
  topic_keys: [NOTE_KEY, PDF_KEY],
  target_retention: 0.9,
};

/** Raising the target for a high-stakes exam. */
export const examUpdateFixture: ExamUpdate = { target_retention: 0.95 };

export const examFixture: Exam = {
  id: EXAM_ID,
  exam_date: "2026-12-03",
  topic_keys: [NOTE_KEY, PDF_KEY],
  target_retention: 0.9,
  days_left: 14,
  status: "upcoming",
  scope: [
    { key: NOTE_KEY, title: "Biology — Cell structure" },
    { key: PDF_KEY, title: "NCERT Biology Class 11 — Chapter 13" },
  ],
  created_at: "2026-11-19T04:30:00.000Z",
};

/** Upcoming first, then (with ?include_past=1) a past exam whose second note was deleted since. */
export const examListResponseFixture: ExamListResponse = {
  exams: [
    examFixture,
    {
      id: PAST_EXAM_ID,
      exam_date: "2026-11-02",
      topic_keys: [NOTE_KEY, DELETED_NOTE_KEY],
      target_retention: 0.95,
      days_left: -17,
      status: "past",
      scope: [
        { key: NOTE_KEY, title: "Biology — Cell structure" },
        { key: DELETED_NOTE_KEY, title: null },
      ],
      created_at: "2026-10-20T10:00:00.000Z",
    },
  ],
};

const FORECAST_ASSUMPTIONS = [
  "Every review is graded Good.",
  "Reviews come before new questions, the weakest first.",
  "One review per question per day, at midday.",
  "No reviews on exam day.",
  "All your daily review slots go to this exam.",
  "Lapse allowance: 12% extra reviews, from your own recent mistakes.",
];

/**
 * 07-exam-mode.md §5.4's synthetic set: 100 questions, 60 already learned, 40 never seen, exam in
 * 14 days. Ten reviews a day get all 100 to 90 %; twelve allow for a 12 % lapse rate.
 */
export const examForecastOnTrackFixture: ExamForecast = {
  exam: {
    id: EXAM_ID,
    exam_date: "2026-12-03",
    days_left: 14,
    target_retention: 0.9,
    topic_keys: [NOTE_KEY, PDF_KEY],
  },
  items: { total: 100, seen: 60, unseen: 40 },
  if_nothing_more: {
    at_target: 15,
    mean_r_exam: 0.51,
    histogram: [40, 0, 0, 0, 2, 6, 12, 14, 11, 15],
  },
  plan: {
    feasible: true,
    required_per_day: 10,
    recommended_per_day: 12,
    minutes_per_day: 6,
    per_day: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 5, 7, 9, 5],
    at_target_with_plan: 100,
    mean_r_exam_with_plan: 0.95,
    histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 100],
  },
  at_current_pace: { slots_per_day: 30, at_target: 100, mean_r_exam: 0.96 },
  status: "on_track",
  headline: { status: "on_track", n: 100, total: 100, target_pct: 90, date: "2026-12-03" },
  assumptions: FORECAST_ASSUMPTIONS,
  approximate: false,
  scheduler_version: "fsrs6-v1",
  lapse_rate: 0.12,
  computed_at: "2026-11-19T04:30:00.000Z",
};

/** Eleven slots a day: enough for the plan, not for the lapse allowance. */
export const examForecastTightFixture: ExamForecast = {
  ...examForecastOnTrackFixture,
  at_current_pace: { slots_per_day: 11, at_target: 100, mean_r_exam: 0.95 },
  status: "tight",
  headline: { status: "tight", required: 10, recommended: 12 },
};

/** Five slots a day: 07 §5.4's "capacity 5" row. */
export const examForecastBehindFixture: ExamForecast = {
  ...examForecastOnTrackFixture,
  at_current_pace: { slots_per_day: 5, at_target: 72, mean_r_exam: 0.72 },
  status: "behind",
  headline: { status: "behind", slots: 5, n: 72, total: 100, target_pct: 90, minutes: 6 },
};

/** The exam is tomorrow: one study day cannot bring 40 new questions to 90 %. */
export const examForecastInfeasibleFixture: ExamForecast = {
  ...examForecastOnTrackFixture,
  exam: { ...examForecastOnTrackFixture.exam, exam_date: "2026-11-20", days_left: 1 },
  if_nothing_more: {
    at_target: 48,
    mean_r_exam: 0.56,
    histogram: [40, 0, 0, 0, 0, 0, 0, 2, 10, 48],
  },
  plan: {
    feasible: false,
    required_per_day: null,
    recommended_per_day: null,
    minutes_per_day: null,
    per_day: [100],
    at_target_with_plan: 60,
    mean_r_exam_with_plan: 0.95,
    histogram: [0, 0, 0, 0, 0, 0, 0, 0, 40, 60],
  },
  at_current_pace: { slots_per_day: 30, at_target: 52, mean_r_exam: 0.68 },
  status: "infeasible",
  headline: { status: "infeasible", n: 60, total: 100, target_pct: 90, date: "2026-11-20" },
};

/** A past exam: no plan, only where recall stood on the day. */
export const examForecastPassedFixture: ExamForecast = {
  ...examForecastOnTrackFixture,
  exam: {
    id: PAST_EXAM_ID,
    exam_date: "2026-11-02",
    days_left: -17,
    target_retention: 0.95,
    topic_keys: [NOTE_KEY],
  },
  items: { total: 12, seen: 12, unseen: 0 },
  if_nothing_more: {
    at_target: 7,
    mean_r_exam: 0.93,
    histogram: [0, 0, 0, 0, 0, 0, 0, 0, 3, 9],
  },
  plan: {
    feasible: false,
    required_per_day: null,
    recommended_per_day: null,
    minutes_per_day: null,
    per_day: [],
    at_target_with_plan: 7,
    mean_r_exam_with_plan: 0.93,
    histogram: [0, 0, 0, 0, 0, 0, 0, 0, 3, 9],
  },
  at_current_pace: { slots_per_day: 30, at_target: 7, mean_r_exam: 0.93 },
  status: "exam_passed",
  headline: { status: "exam_passed", date: "2026-11-02" },
};

/** The exam's notes have no questions yet. */
export const examForecastNoItemsFixture: ExamForecast = {
  ...examForecastOnTrackFixture,
  items: { total: 0, seen: 0, unseen: 0 },
  if_nothing_more: { at_target: 0, mean_r_exam: 0, histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  plan: {
    feasible: true,
    required_per_day: null,
    recommended_per_day: null,
    minutes_per_day: null,
    per_day: [],
    at_target_with_plan: 0,
    mean_r_exam_with_plan: 0,
    histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  at_current_pace: { slots_per_day: 30, at_target: 0, mean_r_exam: 0 },
  status: "no_items",
  headline: { status: "no_items" },
};
