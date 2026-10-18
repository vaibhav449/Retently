# Build Plan & Tech Stack

> **Version:** 0.6 · **Date:** 2026-10-18 · **Team:** Vaibhav Chaubey and Anurag Deshmukh · **Deadline:** none. The plan uses phases with exit criteria instead of weeks.
> **Relationship to other docs:** `mvp-spec-v0.2.md` is still the source of truth for _what_ we build: features, revision engine design, legal. This doc covers _how_ we build it and _in what order_. It replaces v0.2's §11 (architecture details) and §14 (thirteen weeks). Every place this doc disagrees with v0.2 is listed in §3 with the reason. **Who builds what** is in `task-distribution.md`.
> **Status:** draft for discussion. §11 lists the decisions to settle before Phase 0 starts.

---

## 1. Decisions at a glance

- **Next.js for the web app**, TypeScript everywhere, one monorepo.
- **Three deployable apps, with logic in shared packages.** The apps are `web` (Next.js), `realtime` (Hocuspocus + duels) and `worker` (RabbitMQ consumers). Apps stay thin. Every piece of domain logic lives in a package that any app can call.
- **The contract is code.** It lives in a Prisma schema plus Zod schemas, in two shared packages. A change needs approval from both developers.
- **Split by feature, not by layer.** Each developer owns whole features: logic, API and screens.
  - Vaibhav owns the revision engine, RabbitMQ and duels.
  - Anurag owns the workspace, the content pipeline and the teaching assistant.
  - Details are in `task-distribution.md`.
- **Build a walking skeleton first.** The thinnest end-to-end revision loop ships in Phase 1. That way integration happens continuously, not in one big week at the end.
- **Seven phases, each ending in something you can demo.** A phase doesn't start until the previous one is merged, deployed to staging and demoed.
- **Real users start at the end of Phase 3.** Spaced-repetition data needs calendar time, and extra dev time later can't make up for it.

---

## 2. What we're building (one paragraph)

A study workspace where notes and PDFs become a personalised revision schedule. It has a collaborative editor with AI ghost text. The revision engine is FSRS plus a confidence rating given before the answer is revealed, plus detection of misconceptions (confident but wrong). It also has an exam mode that predicts recall on the exam date, a grounded teaching bot, an analytics dashboard and friend-code quiz duels. The full scope and reasoning are in `mvp-spec-v0.2.md`.

---

## 3. What changed from v0.2

| Area              | v0.2                                              | This plan                                                               | Why                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schedule          | 13 fixed weeks                                    | 7 phases with exit criteria                                             | There's no fixed deadline. A phase ends when its exit criteria are met, not when the week ends.                                                                                          |
| Integration       | One week (week 11)                                | Every phase, starting with a walking skeleton in Phase 1                | v0.2's own risk table names integration surprises as a top risk. This plan fixes it structurally.                                                                                        |
| RabbitMQ          | Week 10                                           | Phase 2                                                                 | Generating items for a 100-page PDF means hundreds of LLM calls, which can't run inside one HTTP request. The queue is needed as soon as real PDFs arrive. Learning it is a goal anyway. |
| Item ownership    | `items.user_id`                                   | Items belong to content; each user's memory state lives in `card_state` | With `user_id` on items, shared docs and duels immediately raise the question "whose item is this?" (§7.3).                                                                              |
| Doc text hand-off | Internal HTTP endpoint returning `plain_text`     | `documents.content_md` column + `document.changed` event                | Markdown keeps headings, which gives better chunks and topic tags. All apps share the database, so an internal endpoint would only add one more thing that needs auth.                   |
| Classmate cohort  | Weeks 9–11                                        | From the end of Phase 3                                                 | Review intervals grow to weeks, so two weeks of use shows very little. Start as soon as the review loop works.                                                                           |
| Under-18 users    | Consent gate                                      | 18+ only during the MVP (proposed)                                      | Verifiable parental consent is a project in its own right. See §11.                                                                                                                      |
| Team split        | Track A (workspace) and Track B (learning engine) | Split by feature, end to end, from Phase 0                              | Each developer can build and demo whole features, with fewer hand-offs. Ownership is in `task-distribution.md`.                                                                          |

Everything else in v0.2 still applies: the scope, the revision engine design, the cost-control rules, "no queues in realtime paths" and the DPDP constraints.

---

## 4. Tech stack

| Layer            | Choice                                                                   | Why / notes                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo         | npm workspaces + Turborepo                                               | Workspace membership is declared in the root `package.json`; `package-lock.json` locks dependencies. Turborepo coordinates builds and checks.                                     |
| Language         | TypeScript (strict) everywhere                                           | One language on both sides of the contract. `ts-fsrs` is the official FSRS implementation.                                                                                        |
| Web app          | **Next.js** (App Router)                                                 | Pages, auth, request/response APIs and streaming routes. It **can't** host Hocuspocus or the duel socket.                                                                         |
| UI               | Tailwind + shadcn/ui                                                     | Copy-in components, no design-system lock-in.                                                                                                                                     |
| Charts           | Recharts (or visx)                                                       | Dashboard panels.                                                                                                                                                                 |
| Editor           | TipTap (ProseMirror)                                                     | Ghost text is a local decoration and never goes into the Yjs document.                                                                                                            |
| Collaboration    | Yjs + Hocuspocus                                                         | Hocuspocus's database extension persists Yjs state to Postgres.                                                                                                                   |
| Realtime         | Node + `ws`, in the same process as Hocuspocus                           | Two socket paths: `/collab` (Yjs) and `/events` (our message envelope).                                                                                                           |
| Database         | Postgres + pgvector                                                      | Relational data and vectors in one place.                                                                                                                                         |
| ORM / migrations | Prisma ORM 7 + Prisma Migrate                                            | The Prisma schema generates the TypeScript client. Prisma Migrate applies committed SQL; the initial SQL migration enables pgvector. Vector columns and retrieval remain planned. |
| Validation       | Zod                                                                      | One schema per contract shape, shared by web, realtime and worker.                                                                                                                |
| Auth             | Better Auth                                                              | Users live in our own Postgres, so we can add `dob` and `parent_consent_at`. There are no third-party user-sync webhooks.                                                         |
| LLM              | Vercel AI SDK, wrapped in `packages/llm`                                 | Swappable provider, streaming, structured output against Zod schemas. The wrapper adds budget checks and usage logging.                                                           |
| Scheduler        | `ts-fsrs` + our own SM-2                                                 | Both sit behind the same `Scheduler` interface (v0.2 §7.3).                                                                                                                       |
| Queue            | RabbitMQ + `amqplib`                                                     | Learning message queues is an explicit goal (v0.1 §6).                                                                                                                            |
| PDF parsing      | `unpdf` (per-page text)                                                  | Text PDFs only. Scanned PDFs and OCR are out of scope. Because ingestion sits behind the queue, it can be swapped for a Python worker later without touching anything else.       |
| File storage     | S3-compatible (e.g. Cloudflare R2)                                       | PDFs never go into Postgres. Uploads use signed URLs to a private bucket.                                                                                                         |
| Testing          | Vitest (unit), Playwright (E2E)                                          | Playwright can drive two browser contexts at once, which covers collaboration and duels.                                                                                          |
| CI/CD            | GitHub Actions                                                           | Lint, typecheck, tests, build and a migration check run on every PR. Every push to `main` builds four images, pushes them to GHCR and deploys to the VM.                          |
| Hosting          | One Ubuntu VM running Docker Compose, with Caddy in front (decided, §11) | Only Caddy is public; Postgres and RabbitMQ stay on the private Docker network. Files in `deploy/`, walkthrough in `docs/setup/02-docker/`.                                       |
| Errors           | Sentry (optional)                                                        | Add once there are real users (Phase 3).                                                                                                                                          |

---

## 5. System architecture

```
  Browser ──HTTPS──▶ apps/web (Next.js) ──publish jobs──▶ ┌──────────┐ ──jobs──▶ apps/worker
     │                                                    │ RabbitMQ │            │
     │                                                    │          │ ◀─events───┘
     │                                                    └──────────┘
     │                                                         │ events
     │                                                         ▼
     └──WS /collab, /events───────────────────────▶ apps/realtime
                                                    (Hocuspocus · duels · notification fan-out)

  Every app reads and writes Postgres + pgvector through packages/db.
  apps/web and apps/worker read and write PDFs in object storage.
```

| From → To                 | How                                                       | Used for                                                   |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Browser → web             | HTTPS                                                     | Pages, CRUD, review API, streaming ghost text and chat     |
| Browser → realtime        | WS `/collab` (Hocuspocus protocol)                        | Yjs sync, presence, cursors                                |
| Browser → realtime        | WS `/events` (`{ type, payload, request_id }`)            | Duel turns, ingestion notifications                        |
| web / realtime → RabbitMQ | Publish to the `jobs` exchange                            | `ingest.requested`, `items.generate`, `grade.short_answer` |
| worker → RabbitMQ         | Publish to the `events` exchange, routing key `user.<id>` | `ingest.completed`, `ingest.failed`, `grade.completed`     |
| RabbitMQ → realtime       | Consume `events`                                          | Forward the event to that user's open socket               |

**Realtime auth.** `web` issues a short-lived signed token (about 5 minutes) for the logged-in user. `realtime` verifies it when a socket connects, on both paths. This avoids sharing session cookies across subdomains.

**The queue stays out of realtime paths** (v0.2 §11). Yjs sync, ghost text and duel turns never touch RabbitMQ. Only background work does, plus the notification that background work has finished.

---

## 6. Repo layout and ownership

This is the target layout. Today, the three app skeletons, `db`, `contracts`, and the shared ESLint and TypeScript configuration packages exist. `scheduler`, `revision`, `ingest`, `llm`, and `eval` are planned. See [README.md](README.md) for the current implementation.

```
apps/
  web/          Next.js: UI, auth, request/response API, streaming routes (ghost text, chat)
  realtime/     Node: Hocuspocus on /collab, app socket on /events, duel state machine
  worker/       Node: RabbitMQ consumers for ingestion, item generation, short-answer grading
packages/
  db/           Prisma schema + migrations + client                       ← contract
  contracts/    Zod schemas + fixtures: WS envelope, events, citations, API ← contract
  scheduler/    Scheduler interface, FSRS (ts-fsrs) + SM-2. Pure: no DB, no clock.
  revision/     recordReview(), grade mapping, queue ranker, exam mode, analytics queries
  ingest/       parse → chunk → embed → generate items
  llm/          provider wrapper, prompts, budget check, usage logging
eval/           replay harness + analysis (Phase 6)
docker-compose.yml
```

Who owns each path is listed in `task-distribution.md` §3, and CODEOWNERS should mirror that table when added. `packages/db` and `packages/contracts` belong to both developers.

**The one architectural rule: apps are thin and packages hold the logic.** This rule is what makes three things work:

- "Synchronous now, queue later" becomes a change to who calls `ingest()`, nothing more.
- The review API and the duel server share one grading path, `recordReview()`.
- v0.2's open decision #1 (backend shape) mostly stops mattering. If an endpoint only calls a package, it barely matters which app it lives in.

---

## 7. The shared contract (frozen at the end of Phase 0)

### 7.1 Tables (`packages/db`)

**Jointly owned.** Changes need both approvals.

```
users(id, email, name, created_at, dob, parent_consent_at)      -- Better Auth user + extra fields
documents(id, owner_id, title, yjs_state, content_md, version, updated_at)
document_access(document_id, user_id, role)                      -- owner | editor | viewer
items(id, source_chunk_id, topic_id, type, prompt, answer, options, rubric,
      difficulty_seed, created_at, retired_at)
review_log(id, item_id, user_id, reviewed_at, grade, confidence, correct,
           latency_ms, elapsed_days, context, scheduler_version)  -- confidence nullable (§11.2)
llm_usage(id, user_id, feature, model, input_tokens, output_tokens, cost_usd, created_at)
```

**Owned by Anurag** (content pipeline).

```
sources(id, owner_id, kind, document_id, file_key, title, created_at)   -- kind: note | pdf
chunks(id, source_id, block_ids, page_start, page_end, text, content_hash,
       embedding vector(N), topic_id, created_at, retired_at)
topics(id, name, ...)
```

**Owned by Vaibhav** (revision engine and duels).

```
card_state(user_id, item_id, scheduler_version, state, due_at,
           misconception_until, updated_at)
exams(id, user_id, exam_date, topic_ids, target_retention)
duels(id, code, topic_id, status, created_by, created_at)
duel_players(duel_id, user_id, score, joined_at)
```

Each of you reads the other's tables through package functions or APIs, not ad-hoc queries.

### 7.2 Hand-offs

- **Document text.** The editor keeps `documents.content_md` up to date. It is debounced (about 60s) on store, and block nodes carry stable ids. The editor also emits `document.changed { document_id, version }`. Ingestion never reads `yjs_state`, which preserves v0.2's rule that the learning engine never needs to know Yjs exists.
- **WebSocket envelope** (`/events`): `{ type, payload, request_id? }`. The worker publishes to the `events` exchange, and `realtime` forwards to the user's socket. The `duel.*` message types use the same envelope.
- **Citation.** Every screen that shows a source renders this shape: for an item, a misconception or a chat answer.
  ```ts
  type Citation = {
    chunk_id: string;
    source_id: string;
    source_kind: "note" | "pdf";
    title: string;
    page?: number;
    block_id?: string;
    snippet: string;
  };
  ```
- **`recordReview()`** in `packages/revision` is the _only_ way an answer gets recorded. Both the review API and the duel server call it. It maps confidence × correctness to a grade, runs `scheduler.next()`, and writes `card_state` and `review_log` in one transaction.

Every shape above has a fixture in `packages/contracts/fixtures`, and CI validates each fixture against its Zod schema. That means stubs can't drift from the real contract. The full list of places where your work meets is in `task-distribution.md` §4.

### 7.3 Why items shouldn't carry a `user_id`

v0.2 puts `user_id` on `items`. Two shipping features break that:

- **Shared documents.** Suppose two students co-edit a note. Who owns the items generated from it? Giving each user their own copy multiplies LLM cost, and picking one owner hides the items from the other student.
- **Duels.** Questions come from "the shared item bank", so the opponent answers items the challenger owns. Their `review_log` row then points at an item that isn't theirs. It's unclear where their memory state for that item should live.

**Fix:** items belong to content (item → chunk → source). Each item is generated once and shared by everyone who can read the source. Each user's memory of an item lives in `card_state(user_id, item_id)`. A user's bank is the items from sources they can access, plus any items they've answered elsewhere (for example in a duel).

One side effect to accept on purpose: in a duel, the opponent sees questions generated from the challenger's notes.

---

## 8. Build order

Every phase follows the same pattern:

- Both developers work in parallel against fixtures and wire up before the phase ends.
- The phase is merged to `main` and deployed to staging.
- Each developer demos the _other's_ work on staging. If they can't, it isn't integrated yet.

**The per-person task lists for each phase are in `task-distribution.md` §5.** This section keeps each phase's goal, what it builds and its exit criteria.

### Phase 0 — Foundation

**Goal:** both developers can build in parallel without ever waiting on each other.

**Builds:**

- the monorepo, `docker-compose` (Postgres with pgvector, RabbitMQ), CI and staging deploys
- Better Auth with date of birth and the age gate
- the `realtime` skeleton with an authenticated `/events` socket
- the contract in code

**Exit:** `npm run infra:up`, `npm run db:migrate`, then `npm run dev` runs everything on both laptops. Staging has a working signup and login. A browser on staging opens an authenticated WebSocket to `realtime`.

_Why `realtime` gets deployed now:_ hosting WebSockets is the most common deployment gotcha (v0.2 §11). Better to find out on day 3 than in Phase 2.

### Phase 1 — Walking skeleton

**Goal:** one ugly but complete pass through the core loop: note → item → review → log.

**Builds:**

- a single-user TipTap editor with autosave. Until Yjs arrives in Phase 2, the editor saves TipTap JSON to a temporary `documents.content_json` column.
- the LLM wrapper
- chunking and MCQ generation behind a "Generate questions" button. Autosave never triggers generation.
- `recordReview()` with a placeholder scheduler
- the review API and a bare review screen with _Sure / Think so / No idea_

**Exit:** on staging, a user writes a note, clicks "Generate questions" and answers an MCQ with a confidence level. A `review_log` row then exists with confidence and latency, and an `llm_usage` row exists for the generation.

### Phase 2 — Collaboration, real ingestion and the queue

**Goal:** the workspace becomes multiplayer, and the engine can take real material.

**Builds:**

- Hocuspocus on `/collab`, with presence, cursors and sharing
- PDF upload, per-page text, and embeddings in pgvector. **Lock the embedding model here** (§11.4).
- citations on every item
- the RabbitMQ worker, with retries and a dead-letter queue
- item reconciliation when a source changes
- FSRS and SM-2 behind the scheduler interface

**Exit:**

- Two browsers co-edit with live cursors.
- Editing one paragraph regenerates items for that paragraph only.
- Uploading a 100-page PDF returns immediately, the user is notified when it finishes, and the items cite their page numbers.
- Killing the worker mid-job and restarting it produces no duplicate items.

### Phase 3 — The revision engine

**Goal:** the product. "The editor is the surface. The revision engine is the product." (v0.2 §2)

**Builds:**

- latency-relative grading and the misconception override
- the queue ranker and exam mode
- review screens for all three item types
- cloze and short-answer items with topics, and short-answer grading
- the synthetic-student generator
- the core of RAG retrieval

**Exit:**

- The daily queue respects the minute budget and interleaves topics.
- A confident-but-wrong answer comes back the next day, whatever FSRS's own due date says.
- Exam mode shows predicted recall for the exam date, per item.
- The ranker passes the golden test from `revision-engine-explained.md` §7: order B → C → A → E → F → D.
- **The classmate cohort has been recruited and is using the app.**

### Phase 4 — Analytics and teaching assistant

**Goal:** turn `review_log` into insight, and close the loop from misconception to explanation.

**Builds:**

- analytics endpoints and the five dashboard panels, **calibration curve first**
- the chat UI with clickable citations
- the misconception → explanation flow

**Exit:**

- The dashboard renders from real cohort data plus seeded data.
- Clicking a misconception opens a cited explanation drawn from the student's own source.
- Asking about something that isn't in the notes gets "I don't know".

### Phase 5 — Quiz duels and ghost text

**Goal:** the social layer, built entirely on infrastructure that already works, plus ghost text in the shared editor.

**Builds:**

- the friend-code lobby and a server-authoritative match runtime
- the duel UI, with reconnect
- duel answers through `recordReview({ context: 'duel' })`
- ghost text as a local TipTap decoration
- two-browser Playwright tests for collaboration, ghost text and duels

**Exit:**

- Two users on different networks duel via a code.
- Refreshing mid-duel recovers the game.
- Every answer appears in `review_log` with `context = 'duel'` and moves that user's `card_state`.
- Ghost text works in a shared document, and a Playwright test proves it never reaches the other client.

### Phase 6 — Evaluation and hardening

**Goal:** prove it works and make it safe to put in front of people.

**Builds:**

- Evaluation (v0.2 §12): FSRS vs SM-2 log loss and RMSE; calibration and Brier score over time; misconception recovery rate; LLM cost per active student per day.
- Security pass (§10.5).
- Load check: N concurrent editors in one document, M concurrent duels.
- DPDP review against v0.2 §13.
- A demo script, and the write-up.
- _Stretch,_ only after this phase's exit criteria are met: random matchmaking (Vaibhav) and a browser-extension spike (Anurag).

**Exit:** every number in the write-up regenerates from one command, and the demo script runs cleanly on staging twice in a row.

### Rough sizing

| Phase                             | Rough size |
| --------------------------------- | ---------- |
| 0 Foundation                      | ~1 week    |
| 1 Walking skeleton                | ~2 weeks   |
| 2 Collaboration, ingestion, queue | ~3 weeks   |
| 3 Revision engine                 | ~3 weeks   |
| 4 Analytics + teaching assistant  | ~2 weeks   |
| 5 Duels + ghost text              | ~2 weeks   |
| 6 Evaluation + hardening          | ~2 weeks   |

That's about 15 weeks, with each developer carrying about 15 person-weeks of work (`task-distribution.md` §2). **These numbers are a drift alarm, not a schedule.** With no deadline, the real risk is building forever. If a phase runs past twice its size, cut scope _inside_ the phase. Don't weaken its exit criteria.

---

## 9. Why this order

1. **Walking skeleton before depth.** Integration bugs are cheapest when the system is tiny. Phase 1 proves the contract end-to-end in about the third week instead of week 11.
2. **Capture before intelligence.** `review_log` rows with confidence and latency exist from Phase 1, before FSRS does. This is v0.2's principle, applied even earlier. Every review that isn't logged is evaluation data that can't be recovered.
3. **Add the queue when the pain arrives.** Synchronous ingestion is fine for short notes and breaks on real PDFs. Phase 2 is the moment it breaks, so that's when RabbitMQ arrives, not week 10.
4. **The engine comes before what depends on it.** Analytics reads `review_log`, the teaching bot is triggered by misconceptions, and duels call `recordReview()`. All three need Phase 3 to exist first.
5. **Ghost text after collaboration.** The main ghost-text bug is suggestions leaking into the shared document, and you can only test that once there's a second client. It lands in Phase 5 because it doesn't depend on the revision engine, which keeps both developers' load even while duels are built.
6. **Calendar time is the evaluation bottleneck.** FSRS intervals grow to weeks. Users have to start at the end of Phase 3 for the Phase 6 numbers to mean anything.
7. **Duels last.** They depend on the most other parts (item bank, `recordReview()`, realtime, consent gate) and are the least novel. Putting them last also means they're the safest thing to cut.

---

## 10. Engineering practices

### 10.1 Git and deploys

- Trunk-based: short-lived branches and PRs into `main`. CI must pass: typecheck, lint, unit tests and contract-fixture validation.
- `main` auto-deploys to staging. No long-lived branches.
- Planned: add CODEOWNERS mirroring `task-distribution.md` §3. From Phase 0 on, `packages/db/**` and `packages/contracts/**` need both developers' approval. This is how v0.2's "contract changes need written agreement" works in practice.

### 10.2 Never blocking each other

- Whoever builds a shared piece ships its Zod shape and fixture first. The other developer builds against the fixture until the real thing lands. The full list of shared pieces is in `task-distribution.md` §4.
- If either developer is waiting on the other, the contract is wrong. Fix the contract, not the schedule.

### 10.3 Testing

| What                    | How                                                                                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheduler`, `revision` | Vitest. Golden tests from worked examples that use exact inputs: the queue ranker (§7 of the explainer) and the grade-mapping table. Property tests: R falls over time; _Again_ never increases stability; confident-but-wrong is always due the next day. |
| `contracts`             | Every fixture is parsed by its Zod schema in CI.                                                                                                                                                                                                           |
| `ingest`                | Fixture notes and PDFs → snapshot chunks. Idempotency: the same job twice must produce the same items.                                                                                                                                                     |
| LLM output quality      | About 30 hand-checked chunks → items, re-run whenever prompts change. Cloze items pulled out of context are a known ambiguity risk.                                                                                                                        |
| E2E                     | Playwright with two browser contexts: co-editing, ghost-text isolation, a full duel.                                                                                                                                                                       |

The FSRS worked example in `revision-engine-explained.md` §5 uses illustrative numbers, not `ts-fsrs`'s trained parameters. **Don't golden-test against it.**

### 10.4 Local development

- `npm install` installs all workspace dependencies and generates the Prisma client. Use `npm ci` for a clean install from the committed lockfile.
- `npm run infra:up` starts Postgres (pgvector image) and RabbitMQ (with the management UI).
- `npm run db:migrate` applies committed SQL migrations.
- `npm run db:generate` regenerates the client without a database connection.
- `npm run db:migrate:dev -- --name <change>` creates and applies development migrations after editing `packages/db/prisma/schema.prisma`.
- `npm run db:studio` opens Prisma Studio.
- `npm run dev` runs web, realtime and worker through Turborepo.
- Planned: add `npm run db:seed` to load a fixture user, notes, a PDF, items and, from Phase 3 on, synthetic review history. No seed command or application models exist yet.
- `.env.example` is committed; `.env` never is.

### 10.5 Security checklist

- Both realtime socket paths verify the short-lived token on connect.
- Document access is checked in Hocuspocus `onAuthenticate` **and** on every API read path, including RAG retrieval. Never retrieve chunks from sources the user can't read.
- PDFs go through signed URLs into a private bucket.
- `realtime` treats every client message as untrusted. Duel scoring happens on the server.

### 10.6 LLM cost controls (from the first LLM call)

- Every call goes through `packages/llm`, which checks the user's daily budget and logs to `llm_usage`.
- Ghost text: debounce on pause, abort the in-flight request on each keystroke, cap the context window, use the cheapest model tier.
- Items are generated once per chunk content hash.
- MCQ and cloze are graded for free; short answers are capped per session.
- Different features can use different model tiers, chosen inside the wrapper.

---

## 11. Open decisions (settle before Phase 0 starts, except #4)

1. **Item ownership (§7.3).** _Recommendation:_ items belong to content, with per-user `card_state`. This changes v0.2's contract, so it needs both of us.
2. **Do duels ask for confidence?** _Recommendation:_ no, because it keeps duels fast.
   - Map correct → _Hard_ and wrong → _Again_, with `confidence = null`.
   - Leave duel answers out of the calibration curve and out of latency medians, since time pressure skews both.
   - _Alternative:_ ask for confidence. That gives more calibration data but makes the game slower.
3. **Under-18 users during the MVP.** _Recommendation:_ 18+ only until a verifiable parental-consent flow exists (DPDP, v0.2 §13). School students are part of the primary audience, so this is temporary and the consent flow becomes a priority after the MVP. Recruit the classmate cohort from 18+ students.
4. **LLM provider(s) and embedding model.** The generation provider stays swappable behind the wrapper. The embedding model doesn't: its vector size is baked into the pgvector column, and changing it means re-embedding everything. The embedding provider doesn't have to be the generation provider. **Decide by Phase 2.**
5. **Hosting.** _Decided (2026-10-17):_ one Ubuntu VM with Docker Compose, deployed by GitHub Actions over SSH, images in GHCR. Chosen over Railway so the team learns Docker and CI/CD hands-on. Setup steps: `docs/setup/02-docker/06-vm-setup-aur-pehla-deploy.md`.

---

## 12. Parking lot

New ideas go here, not into the current phase.

- Browser extension (Anurag's stretch after Phase 6; hard stop)
- Random matchmaking (Vaibhav's stretch after Phase 6; designed in v0.2 §8)
- Player-authored duel questions (needs a moderation pass, otherwise skip)
- Tuning queue weights `w1..w5`
- Scanned PDFs, OCR, PPTs, screenshots (competitor analysis, differentiator #4)
- Notes generated from rough material
- B2B layer (only when a real institute asks)
- Native OS overlay (a separate product)
