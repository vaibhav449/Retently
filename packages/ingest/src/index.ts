export { type ChunkDraft, type ChunkingOptions, chunkMarkdown, DEFAULT_CHUNKING } from "./chunker";
export { contentHash, normalizeText } from "./hash";
export {
  IngestError,
  type IngestDeps,
  type IngestResult,
  ingestSource,
  MAX_CHUNKS_PER_RUN,
} from "./ingest";
export { buildMcqItem, MCQ_INSTRUCTIONS, type McqDraft, mcqDraftSchema, mcqPrompt } from "./mcq";
