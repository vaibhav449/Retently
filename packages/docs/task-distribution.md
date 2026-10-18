# Task Distribution

> **Team:** Vaibhav Chaubey · Anurag Deshmukh
> **Version:** 1 · **Date:** 2026-10-13
> **Companion to:** `build-plan.md`, which covers the stack, the architecture, and each phase's goal and exit criteria. This doc says **who builds what**, phase by phase. It replaces `phase-0-1-tasks.md` (the earlier solo plan).

---

## 1. The split

Each of you owns whole features end to end: the logic, the API and the screens. That means fewer hand-offs than a frontend/backend split, and each of you can demo your own work.

|             | Vaibhav                                                                                                                                                                                                        | Anurag                                                                                                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Area**    | The revision engine, the queue and duels                                                                                                                                                                       | The workspace, the content pipeline and the teaching assistant                                                                                                                                                                            |
| **Owns**    | RabbitMQ and the worker · FSRS + SM-2 · `recordReview()` · misconceptions · queue ranker · exam mode · review and exam screens · duels and matchmaking · synthetic students · analytics endpoints · evaluation | App shell and auth · notes editor · real-time collaboration and sharing · ghost text · LLM wrapper and cost controls · PDFs, chunking and embeddings · question generation · short-answer grading · RAG teaching assistant · dashboard UI |
| **Stretch** | Random matchmaking (v0.2 §8)                                                                                                                                                                                   | Browser extension (v0.2 §4)                                                                                                                                                                                                               |
| **Total**   | ~15 person-weeks                                                                                                                                                                                               | ~15 person-weeks                                                                                                                                                                                                                          |

Vaibhav's side is built around RabbitMQ, the revision engine and matchmaking. It also takes three pieces the build plan added on top of v0.2: synthetic students, the analytics endpoints and the evaluation harness. Anurag's side is everything else, sized to match.

---

## 2. Is it equal?

These are rough person-weeks, and the real numbers will drift. What matters is that both totals land near 15 and neither of you waits on the other.

### Vaibhav

| Work                                                                                  | Phase | ~Weeks  |
| ------------------------------------------------------------------------------------- | ----- | ------- |
| Local and staging infra: `docker-compose`, `packages/db`, staging Postgres + RabbitMQ | 0     | 0.5     |
| `apps/realtime` skeleton with the authenticated `/events` socket                      | 0     | 0.25    |
| Review loop v1: `recordReview()`, placeholder scheduler, review API, review screen    | 1     | 1.5     |
| Scheduler: FSRS + SM-2 behind one interface                                           | 1–2   | 1       |
| RabbitMQ: worker, exchanges, retries, dead-letter queue, notifications                | 2     | 1.5     |
| Item reconciliation when a source changes; duplicate-safe redelivery                  | 2     | 0.5     |
| Revision engine: latency, misconceptions, queue ranker, exam mode                     | 3     | 1.5     |
| Review screens for all item types, daily session, exam setup                          | 3     | 1       |
| Synthetic-student generator                                                           | 3     | 1       |
| Analytics endpoints + calibration-curve panel                                         | 4     | 1.5     |
| Duels end to end: friend codes, lobby, match runtime, duel UI                         | 5     | 2.5     |
| Evaluation harness and metrics                                                        | 6     | 1.5     |
| Shared: contract (Phase 0), hardening and demo (Phase 6)                              | 0, 6  | 1       |
| **Total**                                                                             |       | **~15** |

### Anurag

| Work                                                                            | Phase | ~Weeks  |
| ------------------------------------------------------------------------------- | ----- | ------- |
| App shell: monorepo, Next.js, CI, staging deploy                                | 0     | 0.5     |
| Auth: Better Auth, date of birth, age gate, realtime token                      | 0     | 0.5     |
| Notes editor: documents, TipTap, autosave                                       | 1     | 1       |
| LLM wrapper: budget checks, usage logging                                       | 1     | 0.5     |
| Question generation v1: chunker + MCQs                                          | 1     | 0.5     |
| Collaboration: Hocuspocus, presence, cursors, sharing, folders                  | 2     | 2       |
| PDF pipeline: uploads, per-page text, embeddings, citations                     | 2     | 1.25    |
| Question generation v2: cloze, short answer, topics, quality set                | 3     | 1.25    |
| Short-answer grading function                                                   | 3     | 0.5     |
| RAG core: retrieval, pedagogy prompt, refusal, eval set                         | 3     | 1.5     |
| Chat UI + misconception explanation flow                                        | 4     | 1       |
| Dashboard layout + four panels                                                  | 4     | 1       |
| Ghost text                                                                      | 5     | 1.25    |
| Two-browser Playwright suite + LLM cost tuning                                  | 5     | 0.75    |
| Shared: contract (Phase 0); security, load, DPDP, cost analysis, demo (Phase 6) | 0, 6  | 1.5     |
| **Total**                                                                       |       | **~15** |

### Per phase

| Phase                             | Vaibhav | Anurag |
| --------------------------------- | ------- | ------ |
| 0 Foundation                      | 1       | 1.25   |
| 1 Walking skeleton                | 2       | 2      |
| 2 Collaboration, ingestion, queue | 2.5     | 3.25   |
| 3 Revision engine                 | 3.5     | 3.25   |
| 4 Analytics, teaching assistant   | 1.5     | 2      |
| 5 Duels, ghost text               | 2.5     | 2      |
| 6 Evaluation, hardening           | 2.25    | 1.25   |

- **Phase 2 is lighter for Vaibhav on purpose.** RabbitMQ is new, and learning it properly (acks, prefetch, retries, dead-lettering) is a goal in itself.
- **If one of you is lighter in a phase, pull _your own_ next work forward.** For example, Vaibhav can start the evaluation harness in Phase 4. Don't take items off the other person's list without asking.

---

## 3. Who owns which code

Planned: add CODEOWNERS mirroring this table; the repository does not include that file yet.

| Path                                                                                         | Owner                    |
| -------------------------------------------------------------------------------------------- | ------------------------ |
| `apps/web` — shell, auth, documents, editor, uploads, chat, dashboard layout and four panels | Anurag                   |
| `apps/web` — review session, exam setup, duel screens, calibration-curve panel               | Vaibhav                  |
| `apps/web/app/api` — documents, uploads, chat, suggest (ghost text), realtime-token          | Anurag                   |
| `apps/web/app/api` — review, exams, analytics, duels                                         | Vaibhav                  |
| `apps/realtime` — server entry, `/events`, duels                                             | Vaibhav                  |
| `apps/realtime` — `/collab` (Hocuspocus)                                                     | Anurag                   |
| `apps/worker`                                                                                | Vaibhav                  |
| `packages/scheduler`, `packages/revision` (including analytics queries), `eval/`             | Vaibhav                  |
| `packages/ingest`, `packages/llm`                                                            | Anurag                   |
| `packages/db`, `packages/contracts`, `docker-compose.yml`, CI                                | **Both** (two approvals) |

---

## 4. Where your work meets

**Rule:** whoever builds a shared piece ships its Zod shape and a fixture in `packages/contracts` _first_. The other person builds against the fixture until the real thing lands.

| Shared piece                                                                            | Built by                        | Used by                                               | Until it's real                                               |
| --------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| `items` rows (MCQ, then cloze and short answer)                                         | Anurag                          | Vaibhav: review and duels                             | Fixture items                                                 |
| `ingestSource(sourceId)` → added, changed and removed chunks; `generateItems(chunkIds)` | Anurag                          | Vaibhav: worker consumers                             | Called directly from the "Generate questions" route (Phase 1) |
| `document.changed` event                                                                | Anurag: editor, then Hocuspocus | Vaibhav: publishes the ingest job                     | Direct call (Phase 1)                                         |
| `/events` socket + a `subscribe(type, handler)` client helper                           | Vaibhav                         | Anurag: "PDF ready" notification                      | Upload screen shows "processing"                              |
| Realtime token: issue + `verifyRealtimeToken()`                                         | Anurag                          | Vaibhav for `/events`; Anurag for `/collab`           | —                                                             |
| `canAccessSource(userId, sourceId)` in `packages/db`                                    | Vaibhav: owner-only (Phase 1)   | Anurag adds sharing (Phase 2); both use it everywhere | —                                                             |
| `<Citation>` component + `Citation` shape                                               | Anurag                          | Vaibhav: review reveal                                | Plain snippet text                                            |
| `gradeShortAnswer(item, answer)`                                                        | Anurag                          | Vaibhav: `recordReview()` and the worker              | Short-answer items stay hidden                                |
| Analytics endpoints                                                                     | Vaibhav                         | Anurag: dashboard panels                              | Fixtures, then synthetic-student data                         |
| Misconception list                                                                      | Vaibhav                         | Anurag: explanation flow                              | Fixture                                                       |

---

## 5. Phase by phase

### Before Phase 0 — together, one sitting

- [ ] Settle `build-plan.md` §11 decisions 1, 2, 3 and 5, and write "Decided: …" into the doc
- [ ] Pick the LLM provider for question generation and get API keys. The embedding model can wait until Phase 2.
- [ ] Pick a repo name (a placeholder is fine)
- [ ] Create the GitHub repo with both of you as admins. Protect `main`: CI must pass and the other person must approve.

### Phase 0 — Foundation (~1 week)

**Current status (2026-10-18):** the npm workspace, app skeletons, shared configuration, Prisma setup, local infrastructure configuration, and CI/deploy configuration exist. Authentication, application tables, job consumers, collaboration, and study features are not implemented. Checked tasks below refer to repository configuration; staging setup and deployment still need verification.

**Anurag**

- [x] Monorepo: npm workspaces + Turborepo, shared strict TypeScript presets in `packages/typescript-config`, ESLint, Prettier, and Vitest with passing contract, realtime, and worker tests
- [x] `.gitignore` (including `.env`) and a committed `.env.example`
- [ ] `apps/web`: Next.js with App Router, TypeScript and Tailwind, then run `shadcn/ui` init
- [x] GitHub Actions configuration: `npm ci`, formatting, typecheck, lint, tests, build, and migration checks on every PR
- [ ] Staging deploy for `web`; `main` deploys itself
- [ ] Better Auth: email + password with the Prisma adapter, plus `dob` and `parent_consent_at` fields. Signup asks for date of birth and applies the §11.3 decision. Logged-out visitors are redirected to login.
- [ ] `/api/realtime-token` issues a short-lived signed token, plus a `verifyRealtimeToken()` helper that both sockets use

**Vaibhav**

- [x] `docker-compose.yml`: Postgres from a pgvector image, and RabbitMQ with the management UI
- [x] `packages/db`: Prisma ORM 7 + Prisma Migrate and `npm run db:migrate`. The first migration runs `CREATE EXTENSION IF NOT EXISTS vector`. The schema is `packages/db/prisma/schema.prisma`; `npm install` generates the client. Application models and seed data are still planned.
- [ ] Staging Postgres (confirm pgvector works there) and staging RabbitMQ; migrations run on deploy
- [ ] `apps/realtime` skeleton: an `/events` socket that verifies the token and echoes a message, deployed to staging
- [ ] `packages/scheduler`: the `Scheduler` interface and types (v0.2 §7.3)

**Together**

- [ ] Contract in code: the Phase 1 tables in `packages/db`, plus Zod shapes and fixtures in `packages/contracts` for `Item`, `Citation`, the review endpoints and the WebSocket envelope
- [ ] CODEOWNERS from §3. You both approve the contract PR.

**Exit:** `npm run infra:up`, `npm run db:migrate`, then `npm run dev` runs everything on both laptops. Signup and login work on staging. A browser on staging opens an authenticated WebSocket to `realtime`.

### Phase 1 — Walking skeleton (~2 weeks)

**Anurag** — note → questions

- [ ] Documents: list, create, rename, delete, with ownership checked on the server
- [ ] TipTap editor (StarterKit). Debounced autosave writes `content_json` and `content_md` and bumps `version`. `content_json` is temporary until Yjs arrives in Phase 2.
- [ ] `packages/llm`:
  - Vercel AI SDK with the chosen provider
  - `llm_usage` logging, using a small per-model price table
  - per-user daily budget checked before each call
  - tests
- [ ] `packages/ingest` v1:
  - chunker that splits on headings and paragraphs, gives each chunk a `content_hash`, and skips chunks too short for a fair question
  - MCQs via structured output, with options shuffled before storing
  - skips chunks that already have items
  - caps the number of chunks per run, and stops cleanly when the budget runs out
- [ ] Tests: chunker snapshots on 2–3 fixture notes; running generation twice creates no new items
- [ ] "Generate questions" button: flushes any pending autosave, calls `ingestSource()` directly and shows how many questions were made. Autosave never triggers generation.

**Vaibhav** — question → logged review

- [ ] `card_state` table, and a placeholder scheduler where everything is due tomorrow (`version: 'placeholder-v0'`)
- [ ] `packages/revision` — `recordReview()`:
  - grades correctness
  - maps confidence × correctness to a grade (v0.2 §7.4; _Sure_ + correct → _Good_ until Phase 3 adds fast/slow)
  - runs `scheduler.next()`
  - writes `card_state` and `review_log` in **one transaction**, with `context = 'solo'`
- [ ] `canAccessSource()`, owner-only for now
- [ ] `GET /api/review/next` sends **no correct answer** in the payload. `POST /api/review/answer` returns whether the answer was right, the correct answer and the citation.
- [ ] Review screen:
  - flow: question → _Sure / Think so / No idea_ → pick an option → reveal
  - `latency_ms` measured from question shown to answer submitted
  - a "nothing due" state
  - decide whether options appear before or after the confidence pick, and keep that fixed
- [ ] Tests: every row of the grade-mapping table; a failed `review_log` insert leaves `card_state` unchanged
- [ ] Start FSRS (`ts-fsrs`) and SM-2 behind the scheduler interface. Keep them pure; they don't get wired in yet.

**Wire-up:** Vaibhav builds on fixture items until Anurag's generation lands. You connect the two in the last days of the phase.

**Exit:** on staging, a user writes a note, clicks "Generate questions" and answers an MCQ with a confidence level. The database then has a `review_log` row with confidence and latency, and an `llm_usage` row for the generation.

### Phase 2 — Collaboration, real ingestion and the queue (~3 weeks)

**Anurag**

- [ ] `/collab` in `apps/realtime`: Hocuspocus, with Yjs state persisted to `documents.yjs_state`. Convert existing notes from `content_json`, then drop that column.
- [ ] Presence and live cursors, with names and colours
- [ ] Sharing: invite by email or link, with roles in `document_access`, enforced in `onAuthenticate`. Extend `canAccessSource()` to cover shared documents; Vaibhav reviews the change.
- [ ] Folders and organisation
- [ ] On store (debounced): write `content_md` with stable block ids and emit `document.changed`
- [ ] Object storage bucket, signed upload URLs and a PDF upload screen
- [ ] PDF → per-page text → chunks carrying `page_start` / `page_end`
- [ ] **Lock the embedding model** (§11.4), then store embeddings in pgvector with an HNSW index
- [ ] A citation payload on every item, and a `<Citation>` component that jumps to the note block or PDF page

**Vaibhav**

- [ ] `apps/worker`: connects to RabbitMQ with a prefetch limit. A `jobs` exchange carries `ingest.requested` and `items.generate`; an `events` exchange carries results.
- [ ] Consumers call Anurag's `ingestSource()` and `generateItems()`. They ack on success, retry with backoff, and dead-letter after repeated failures.
- [ ] Publish `ingest.requested` from the upload route and on every `document.changed`
- [ ] Item reconciliation when a source changes:
  - Items whose chunk disappeared or changed get `retired_at` if they have review history, and are deleted if they don't.
  - Only new chunks get `items.generate` jobs.
  - A redelivered message never creates duplicates.
- [ ] The worker publishes `ingest.completed` / `ingest.failed`, and `realtime` forwards them to the user's socket. Ship the `subscribe(type, handler)` client helper.
- [ ] Finish FSRS and SM-2 with property tests, then swap FSRS in for the placeholder inside `recordReview()`

**Exit:**

- Two browsers co-edit with live cursors.
- Editing one paragraph regenerates items for that paragraph only.
- Uploading a 100-page PDF returns immediately, the user is notified when it finishes, and the items cite their page numbers.
- Killing the worker mid-job and restarting it produces no duplicate items.

### Phase 3 — The revision engine (~3 weeks)

**Vaibhav**

- [ ] Fast vs slow: a rolling median latency per user and item type, excluding duel answers
- [ ] Misconception override: _Sure_ + wrong → due tomorrow regardless of FSRS (`misconception_until`)
- [ ] Queue ranker:
  - the priority formula (v0.2 §7.5)
  - a minute budget
  - the 60/25/15 mix
  - the backlog override
  - topic interleaving
  - a golden test that expects the order B → C → A → E → F → D
- [ ] Exam mode: `exams` table and API, `R_exam` for every in-scope item, and urgency fed into the ranker
- [ ] Review screens for MCQ, cloze and short answer, with the citation after reveal
- [ ] Daily session view (budget, progress) and the exam setup screen (date + topics)
- [ ] Short-answer path: call Anurag's `gradeShortAnswer()`. If it's slower than about 2 seconds, move it to the worker and return the result over `/events`.
- [ ] Synthetic-student generator: simulated users with known forgetting parameters, run through `recordReview()` with an injected clock. Add the planned `npm run db:seed` command to load them onto staging; it does not exist yet.

**Anurag**

- [ ] Cloze items from note text, and short-answer items with a rubric
- [ ] Topic tagging for chunks and items (`topics` table)
- [ ] `gradeShortAnswer(item, answer)`: rubric-based, returns correctness plus feedback, capped per session
- [ ] Item quality set: about 30 hand-checked chunks → items, re-run whenever prompts change
- [ ] RAG core:
  - top-k retrieval filtered through `canAccessSource()`
  - a pedagogy prompt (explain, then a check-understanding question)
  - a refusal below the similarity threshold
- [ ] Retrieval eval set: about 30 questions with known source chunks, used to tune k and the threshold

**Together**

- [ ] Recruit the classmate cohort (18+) and get them using the review loop. Spaced-repetition data needs calendar time.

**Exit:**

- The daily queue respects the minute budget and interleaves topics.
- A confident-but-wrong answer comes back the next day, whatever FSRS's own due date says.
- Exam mode shows predicted recall for the exam date, per item.
- The ranker golden test passes.
- The cohort is using the app.

### Phase 4 — Analytics and teaching assistant (~2 weeks)

**Vaibhav**

- [ ] Ship the Zod shapes and fixtures for every endpoint _first_, so Anurag can build panels in parallel
- [ ] Analytics endpoints (the logic lives in `packages/revision`):
  - mastery per topic
  - calibration, Brier score and an over/under-confidence verdict, using solo answers only
  - the misconception list, with citations
  - retention forecast, with the items per day needed to hit target
  - 14-day workload
- [ ] The calibration-curve panel, the one no competitor has
- [ ] _If time allows:_ start the evaluation harness (Phase 6)

**Anurag**

- [ ] Dashboard layout, plus the mastery heatmap, misconception list, retention forecast and workload panels
- [ ] Chat UI with streaming answers and clickable citations
- [ ] Misconception flow: from the misconception list, or from a wrong _Sure_ answer, show _"You were confident that X. Here's what your notes say."_

**Exit:**

- The dashboard renders from real cohort data plus seeded data.
- Clicking a misconception opens a cited explanation drawn from the student's own source.
- Asking about something that isn't in the notes gets "I don't know".

### Phase 5 — Quiz duels and ghost text (~2 weeks)

**Vaibhav** — duels and matchmaking

- [ ] `duels` and `duel_players` tables; friend codes that are short, hard to guess and expire
- [ ] Lobby on `/events`: create → share the code → join → pick a topic
- [ ] Server-authoritative match runtime in `apps/realtime`. Turns, timers and scoring live on the server; clients only render.
- [ ] Question sourcing: 5 MCQs per player from the challenger's topic, skipping retired items
- [ ] Answers go through `recordReview({ context: 'duel' })`, following the §11.2 decision
- [ ] Duel UI: lobby, live scores and a results screen. Reconnect handling, so a refresh mid-match resumes it.
- [ ] 18+ / consent gate on duels
- [ ] Playwright: a full duel across two browser contexts

**Anurag** — ghost text and the shared-editor tests

- [ ] Ghost text:
  - a TipTap decoration that never goes into Yjs
  - triggered on a pause or a paragraph boundary
  - aborts the in-flight request on each keystroke
  - streams the suggestion, and Tab accepts it
  - per-user caps through `packages/llm`
- [ ] Playwright: two-browser co-editing, and proof that ghost text never reaches the other client
- [ ] Cost tuning: review the cohort's `llm_usage`, then adjust model tiers, debounce timing and caps

**Exit:**

- Two users on different networks duel via a code, and a refresh mid-duel recovers the game.
- Every duel answer appears in `review_log` with `context = 'duel'` and moves that user's `card_state`.
- Ghost text works in a shared document and never reaches the other client.

### Phase 6 — Evaluation and hardening (~2 weeks)

**Vaibhav**

- [ ] Evaluation harness in `eval/`: replay `review_log` through FSRS and SM-2 using the production scheduler code, and report log loss and RMSE per bin
- [ ] Calibration over time and the misconception recovery rate (v0.2 §12)
- [ ] Load check: many concurrent duels
- [ ] The evaluation section of the write-up

**Anurag**

- [ ] LLM cost per active student per day, from `llm_usage`
- [ ] Security pass (`build-plan.md` §10.5): token checks on both sockets, document access on every read path including RAG, signed uploads
- [ ] Load check: many concurrent editors in one document
- [ ] DPDP review against v0.2 §13

**Together**

- [ ] A demo script that runs cleanly on staging twice in a row
- [ ] Every number in the write-up regenerates from one command

**Stretch, only after the Phase 6 exit:**

- **Vaibhav — random matchmaking:**
  - a per-topic queue in `realtime`, matching players of similar mastery
  - 18+ only
  - report, block and rate limits before any stranger is matched (v0.2 §8)
- **Anurag — browser extension spike:** Chromium; highlight text on a web page and clip it into notes

---

## 6. Working rules

- **Seam first.** Ship the shape and fixture before the implementation (§4).
- **Demo each other's work.** At the end of every phase, Vaibhav demos Anurag's features on staging and Anurag demos Vaibhav's. If you can't, it isn't integrated yet.
- **Contract changes need both of you.** Any PR touching `packages/db` or `packages/contracts` needs both approvals.
- **Finished early?** Pull your own next work forward. Ask before taking anything from the other person's list.
- **A 15-minute sync once a week:** what shipped, what's blocked, and which seam each of you needs next.
