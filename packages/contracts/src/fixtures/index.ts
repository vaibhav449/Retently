/**
 * Sample data for every contract shape. Build against these until the real thing lands;
 * fixtures.test.ts checks each one against its schema in CI, so they can't drift.
 * Import from "@repo/contracts/fixtures" in tests and stubs, never in production code.
 */
import type { Citation } from "../citation";
import type { ClozeItem, McqItem, ShortAnswerItem } from "../item";
import type { ReviewAnswerRequest, ReviewAnswerResponse, ReviewNextResponse } from "../review";
import type { WsEnvelope } from "../ws";

const NOTE_SOURCE_ID = "6b1f0c2e-4d3a-4f8e-9a1b-2c3d4e5f6a7b";
const PDF_SOURCE_ID = "7c2a1d3f-5e4b-4a9f-8b2c-3d4e5f6a7b8c";
const NOTE_CHUNK_ID = "8d3b2e4a-6f5c-4b0a-9c3d-4e5f6a7b8c9d";
const PDF_CHUNK_ID = "9e4c3f5b-7a6d-4c1b-8d4e-5f6a7b8c9d0e";

export const mcqItemFixture: McqItem = {
  id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  source_chunk_id: NOTE_CHUNK_ID,
  type: "mcq",
  prompt: "Which organelle is the site of aerobic respiration?",
  answer: "Mitochondrion",
  options: ["Ribosome", "Mitochondrion", "Golgi apparatus", "Lysosome"],
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

export const reviewNextResponseFixture: ReviewNextResponse = {
  item: {
    item_id: mcqItemFixture.id,
    type: "mcq",
    prompt: mcqItemFixture.prompt,
    options: mcqItemFixture.options,
  },
};

export const reviewNextEmptyFixture: ReviewNextResponse = { item: null };

export const reviewAnswerRequestFixture: ReviewAnswerRequest = {
  item_id: mcqItemFixture.id,
  confidence: "sure",
  response: "Ribosome",
  latency_ms: 4200,
};

/** The confident-but-wrong case: a misconception. */
export const reviewAnswerWrongFixture: ReviewAnswerResponse = {
  correct: false,
  correct_answer: "Mitochondrion",
  citation: noteCitationFixture,
};

export const reviewAnswerCorrectFixture: ReviewAnswerResponse = {
  correct: true,
  correct_answer: "Mitochondrion",
  citation: noteCitationFixture,
};

export const wsEnvelopeFixture: WsEnvelope = {
  type: "ingest.completed",
  payload: { source_id: PDF_SOURCE_ID, items_created: 42 },
  request_id: "req_01",
};
