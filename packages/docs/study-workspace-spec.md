# AI-Native Collaborative Study Workspace — Product & Technical Spec

> **Implementation update (2026-10-18):** this document describes product scope and earlier planning. The current repository uses npm workspaces, Turborepo, and Prisma ORM 7 with Prisma Migrate. See [the current implementation overview](README.md) and [the build plan](build-plan.md) for the active stack, commands, and implementation status. Planned features below are not all implemented.

> Working title: **TBD** · Status: living document (v0.1) · Owner: solo developer · Timeline: open-ended
>
> This is a planning document, not a commitment. It captures scope, sequencing, architecture, and the honest constraints. Revise it as reality pushes back.

---

## 1. One-line thesis

An AI-native collaborative study workspace: write and revise notes together, get inline AI writing suggestions, learn any PDF or your own notes through a grounded teaching bot, and revise by challenging others to topic-based quiz duels — positioned for students and exam-prep, not as a generic notes app.

---

## 2. Why this framing (and not "a notes app")

"Notes app" is a bloodbath — Notion, Google Docs, and Obsidian are free and excellent, so there is no room to win there. The defensible angle is **learning**, aimed at a specific audience: students and the Indian exam-prep market (boards, JEE, NEET, competitive exams), where a social/competitive study hook is not commoditized.

The product's value is not the editor. Nobody pays for an editor. The value is in the **outcomes and access** layered on top: the teaching bot, the revision quizzes, the "test myself before the exam" loop.

---

## 3. Target users

- **Primary:** students revising a syllabus (school boards, competitive exam prep).
- **Secondary (later):** coaching institutes / schools as B2B buyers — but only reached bottoms-up, once students are already using the product (see §8).

---

## 4. Feature set (finalized scope — nothing more, nothing less)

### Phase 1 — Consumer core (the MVP)

1. **Notes editor** — rich-text editing, create/organize notes, auth, persistence.
2. **Real-time collaborative editing** — multiple people in one document, live cursors and presence.
3. **Per-cursor AI writing suggestions** — Copilot-style ghost text, one independent suggestion per cursor, accept on Tab.
4. **AI teaching assistant** — learns from uploaded PDFs and the user's own notes, with grounded/cited answers (RAG).
5. **Quiz duels** — topic-based random matchmaking; each player asks questions and an AI agent asks questions; answers graded by LLM (rubrics or MCQs); moderation on user-written questions.

### Phase 2 — Web capture

6. **Browser extension** — highlight and drop sticky notes over any web page, clipped straight into your notes. Chromium (Chrome/Edge) first.

### Later — B2B layer (build only when a real institute asks)

7. **AI doubt-solver trained on the institute's own material** — 24/7, grounded and cited to their content.
8. **Teacher/owner analytics dashboard** — per-student, per-topic mastery, plus at-risk/churn flagging.
9. **Auto-generated tests from their material + auto-grading + analytics.**
10. **Institute-scoped quiz duels** — inter-batch leaderboards and weekly battles.
11. **Auto-generated parent progress reports.**
12. **Bulk content ingestion, batch organization, and white-label branding.**

### Explicitly out of scope

- **System-wide "notes over any UI" overlay.** The original "any UI" version means a native OS overlay (transparent always-on-top windows, OS screen permissions, per-platform work). It shares no infrastructure with the rest and is a separate product. Scoped down to the web-page-only browser extension (feature 6). Revisit the native version, if ever, as its own thing.

---

## 5. Technical architecture

### Stack

| Layer            | Choice                                            | Notes                                                                |
| ---------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| Frontend         | Next.js + TypeScript + Tailwind                   |                                                                      |
| Editor           | TipTap (on ProseMirror)                           | Lexical is the alternative                                           |
| Real-time collab | Yjs (CRDT) + Hocuspocus server                    | Handles auth + persistence better than raw y-websocket               |
| Database         | Postgres                                          |                                                                      |
| Vector store     | pgvector (Postgres extension)                     | Keeps RAG in one database early                                      |
| LLM              | Provider behind a single swappable interface      | Do **not** self-host models early — it's a rabbit hole               |
| Auth             | Off-the-shelf (Clerk / Auth.js / Supabase)        | Don't hand-roll auth                                                 |
| Message queue    | RabbitMQ (see §6)                                 | For background/async work only                                       |
| Realtime runtime | Persistent runtime (Railway / Fly / Render / VPS) | **Not** serverless — long-lived WebSockets need a persistent process |

### Key architectural decisions & gotchas

- **Serverless (e.g. Vercel) is fine for the Next.js app but bad for long-lived WebSockets.** The collab server and matchmaking need a persistent runtime.
- **Ghost text must stay local.** AI suggestions are a local editor decoration and must never be written into the shared Yjs document — otherwise every collaborator sees everyone else's suggestions.
- **"Per independent cursor" mostly solves itself.** Each client generates suggestions locally for its own cursor, so there's no server-side coordination needed for that feature. The real work is cost control, not coordination.
- **Grounded, cited answers are a requirement, not a nicety.** For the teaching bot (and especially the B2B doubt-solver), a hallucinated wrong answer damages credibility/reputation. Answers must be retrieved from source content and cited.
- **Web-highlight anchoring is the hard part of the extension.** Making a highlight reappear in the right place on dynamic / lazy-loaded / changed pages is a known problem (fuzzy text-quote anchoring; libraries exist). Edge cases live in SPAs, infinite scroll, and content behind login.

---

## 6. Message queue design

A message queue belongs in **background/async work only — never in real-time paths.** It does _not_ go near collaborative editing (Yjs sync), per-cursor suggestions (low-latency streaming), or the live question exchange in a duel (WebSockets). Putting a queue there adds latency and breaks the feel.

### Where the queue earns its place

- **PDF/notes ingestion → embedding pipeline** — the flagship use case. Upload returns instantly; a worker parses → chunks → embeds → writes to pgvector in the background.
- **Batch quiz-question generation** from a topic or someone's notes.
- **Async answer grading** in duels, if grading takes more than a second or two.
- **Emails and parent progress reports** (B2B, later) — scheduled generation and sending.

### Recommendation

- **Use RabbitMQ** — chosen deliberately because the goal is to _learn message queues in depth_. It exposes the real model that transfers to every broker: producers/consumers, exchanges (direct/topic/fanout) and routing keys, queues and bindings, acknowledgments (ack/nack), delivery guarantees (at-most-once vs at-least-once; "exactly-once" is largely a myth), prefetch/QoS, dead-letter queues, and idempotency. A single node runs fine in Docker for a personal project.
- **Pragmatic alternative:** BullMQ (Redis-backed) if the goal were just to ship — retries, delays, cron, concurrency, rate limiting out of the box. Or pg-boss / Graphile Worker to run a queue inside the Postgres you already have (zero new infrastructure).
- **Avoid Kafka here.** It's distributed event-streaming (topics/partitions/offsets/consumer groups) — a different paradigm, heavy to operate, and overkill at this scale. Worth learning later if event-streaming systems interest you; wrong as a first queue for this project.

### First thing to build with it

The **ingestion pipeline**, because it exercises the whole model end to end: the API receives an upload, publishes a message to an exchange, and returns "processing" immediately; a worker consumes it, does parse/chunk/embed/store, acks on success, dead-letters on repeated failure, and notifies the user over the existing WebSocket when done. One worker touches producers, consumers, exchanges, acks, retries, and DLQs in a single real feature.

---

## 7. Build sequence (every milestone independently deployable)

Solo + open-ended means the real risk isn't capability — it's building forever and never shipping. So every milestone must be deployable and demoable on its own; never a six-month branch hiding a broken monolith.

- **M0 — Foundation.** Auth, document CRUD, single-user TipTap editor, Postgres persistence, and a deploy pipeline from day one. → A working single-user notes app.
- **M1 — Collaboration.** Yjs + Hocuspocus, presence (live cursors, who's here), persist Yjs state to Postgres. → Real-time multiplayer editing. First big demo moment.
- **M2 — AI suggestions (the differentiator).** Local ghost-text decoration; debounced trigger on pause/paragraph boundary → LLM call with surrounding context → stream suggestion → accept on Tab. Hard part is cost control (debounce, trigger on pauses not keystrokes, cap context window).
- **M3 — Teaching assistant (RAG).** PDF → parse → chunk → embed → pgvector; retrieve + LLM with a pedagogy prompt (explain, then check understanding). Index the user's own notes too — they're already text, so teaching from a personal notebook is nearly free.
- **M4 — Quiz duels.** Start simpler than the full vision: MCQ-based, same-topic matching, questions generated from a topic or notes. Then layer in real-time matchmaking (queue + WebSocket), the 3-questions-each mechanic, and LLM grading with rubrics. Non-negotiable: run every user-authored question through a moderation pass before it reaches the opponent; add reporting + rate limits.
- **Phase 2 — Browser extension.** After the core exists (depends on M0/M1 backend). Chromium first.
- **Later — B2B layer.** Only when a real institute is asking (see §8).

---

## 8. Monetization (honest)

**Core principle:** nobody pays for the editor; people pay for outcomes and access. Put cheap-to-run things (editing, collaboration, storage — Yjs sync costs almost nothing) in the free tier; gate the _expensive_ AI (teaching bot, duels, suggestions) behind caps or payment. Free tier is acquisition; AI limits are the paywall; costs stay aligned with pricing.

**Three revenue mechanisms, in order of money vs effort:**

1. **Freemium subscription (direct to students).** Paid tier unlocks generous AI. Reality: consumer freemium converts at ~1–3% (students skew low); it's a volume game and modest at small scale. Example: 20,000 active students × 2% × ₹150/mo ≈ ₹7L/year minus AI costs — real but modest, and getting to 20k users is the hard part. Keep pricing low for the audience (think ~₹99–299/month, sold as semester/annual).
2. **BYOK / credits.** Let power users plug in their own LLM API key so heavy usage costs _them_, not you. Not really revenue — it's "don't lose money while growing," and lets you be generous to enthusiasts at zero marginal cost.
3. **B2B institutional (per-seat to coaching centers / schools).** Where the real money is: one institute of 800 students × ₹150/student/year = ₹1.2L/year from a _single_ deal; twenty deals ≈ ₹24L/year. It works because the payer (institution, has a budget) isn't the price-sensitive party (student). But it's a _different job_ — sales, relationships, admin dashboards, long cycles — so it's the destination, not the starting line.

**Cost control is the one thing that can't be deferred** (usage caps, rate limits, BYOK) — because "don't go bankrupt running a free tool" is a day-one problem, independent of whether you ever charge anyone. Per-action LLM cost (especially per-cursor suggestions) is the thing to watch.

**Do not:** run ads (see §9), or sell user data (illegal and unethical, especially with minors involved).

---

## 9. Constraints, risks & hard truths

### Legal — India DPDP Act (this is load-bearing)

- A "child" is anyone **under 18** (uniform threshold — stricter than GDPR/COPPA at 13–16).
- **Absolute prohibition** on tracking/behavioural monitoring and on **targeted advertising directed at children** — cannot be unlocked by parental consent.
- **Verifiable parental consent** is required to process a child's data; self-declared age is explicitly _not_ enough (age verification needed).
- Penalties up to **₹200 crore** for children's-data violations; apply to a one-person operation the same as a large company.
- **Implication:** targeted ads are off the table. Purely contextual (non-tracking) ads are technically permissible but pay a tiny fraction and cheapen a study tool — not worth it. This shapes a real public launch, not the build phase.
- _Not legal advice — confirm specifics with a lawyer before launching to real users._

### Product / execution risks

- **Scope.** Five features is a lot solo. Sequence discipline and independently-deployable milestones are the mitigation.
- **LLM cost.** Every AI action costs real money; per-cursor suggestions are the worst offender. Debounce hard, cap context, enforce usage limits.
- **LLM grading is noisy** and can feel unfair on free-form answers. Mitigate with rubrics or MCQs, especially at first.
- **Hallucination** in teaching/doubt-solving is a reputation risk → grounded, cited RAG only.
- **Stranger matching + minors** creates moderation/safety obligations. The structured Q&A format helps (it isn't open chat), but users can type anything as a "question" → moderation pass, reporting, rate limits are required.
- **Safari** is painful for the extension; **Chromium first**, Firefox is a small delta.

### Competitive reality (B2B)

- The B2B _infrastructure_ layer (branded app, fee collection, live classes, parent messaging, student management) is already owned by well-funded incumbents — **Classplus** (~$158M raised) and **Teachmint**. A solo dev cannot out-build that layer, and even those companies found the pure-SaaS model hard (Teachmint pivoted toward smart-classroom hardware; Classplus moved into B2C test prep).
- **The gap — and the only viable B2B angle — is that none of them are AI-native.** They're operations/branding tools. The opening is the AI outcomes/engagement layer: doubt-solver on the institute's own content, AI-graded adaptive revision, analytics. Don't sell infrastructure; sell better outcomes and stickier students.
- **Go-to-market is bottoms-up, not cold sales.** Students at an institute use the consumer app → a teacher notices → the owner asks "can I see how my whole batch is doing?" That question is the B2B entry. So build the institute dashboard _for a specific design-partner institute when they ask_ — never speculatively.

---

## 10. Open decisions (yours to make)

1. **Backend shape:** standalone backend from day one, vs starting with Next.js API routes and splitting the realtime service out when M1/M4 force it.
2. **LLM provider:** which one, trading cost against quality (behind the swappable interface either way).
3. **The free/paid line:** exactly which features sit on which side of the paywall (the decision that makes or breaks freemium).

---

## 11. Immediate next step

Design one of the hard core pieces in detail — the **collaboration layer (M1)** or the **per-cursor AI suggestions (M2)** — since that's where the real engineering decisions live. Or go deep on **RabbitMQ concepts + the ingestion worker**, given the goal of learning queues in depth.

---

## References (external facts)

- India DPDP Act, children's data (Section 9): https://www.dpdpindia.in/dpdp-children.html
- Classplus business model / pivot context: https://inc42.com/features/classplus-flips-its-edtech-playbook/
- Classplus company/funding overview: https://inc42.com/company/classplus/

_(Verify legal specifics with a qualified lawyer; market/competitor details change over time.)_
