/**
 * Sample data for every contract shape. Build against these until the real thing lands;
 * fixtures.test.ts checks each one against its schema in CI, so they can't drift.
 * Import from "@repo/contracts/fixtures" in tests and stubs, never in production code.
 */
import type { Citation } from "../citation";
import type { ClozeItem, McqItem, ShortAnswerItem } from "../item";
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

export const realtimeTokenResponseFixture: RealtimeTokenResponse = {
  token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.signature",
  expires_in: 300,
};
