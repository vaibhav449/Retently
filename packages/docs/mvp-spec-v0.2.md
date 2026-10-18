# AI-Native Collaborative Study Workspace — MVP Spec

> **Implementation update (2026-10-18):** this document describes product scope and earlier planning. The current repository uses npm workspaces, Turborepo, and Prisma ORM 7 with Prisma Migrate. See [the current implementation overview](README.md) and [the build plan](build-plan.md) for the active stack, commands, and implementation status. Planned features below are not all implemented.

> **Version:** 0.2 (MVP scope) · Supersedes v0.1 planning doc
> **Team:** 2 developers · **Timeline:** 13 weeks (one semester)
> **Status:** buildable spec — the shared contract in §5 is frozen from week 1

---

## 1. What changed from v0.1

v0.1 was an open-ended product plan. This is a semester-scoped build spec. Three substantive changes:

1. **New core feature: the revision engine.** A per-student scheduler that decides what to revise today, tests memory _and_ confidence, and feeds analytics. This is now the centre of the product, not an add-on — it is the only component with a real algorithm, real data, and an evaluation you can write up.
2. **Duel matchmaking changed** from random strangers to challenge-by-code (see §8). Scope is unchanged; risk and demo quality both improve.
3. **Browser extension demoted** from Phase 2 deliverable to stretch goal (see §4).

Nothing else was cut. The full Phase 1 feature set ships.

---

## 2. MVP thesis

A study workspace where your notes and PDFs become a personalised revision schedule. The system decides what you should revise today, tests both what you remember and how confident you were, catches the things you believe but have wrong, and shows you exactly where you stand before your exam — solo or against a classmate.

The editor is the surface. The revision engine is the product.

---

## 3. The insight that makes full scope viable

**Six features, but only two systems.**

| Feature      | What it actually reuses                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| Quiz duels   | The same `items` bank the revision engine generates                                    |
| Duel answers | Write to `review_log` identically to a solo review — same grade, same scheduler update |
| Teaching bot | The same pgvector chunks the item generator already indexed                            |
| Analytics    | Pure aggregation over `review_log` — no new pipeline                                   |

Once the item bank and scheduler exist (week 5), duels are a realtime layer and a UI over infrastructure that already works. This is why six features fit in thirteen weeks with two people, and it is also what makes the project coherent rather than five things bolted together.

---

## 4. Scope

### Shipping

1. **Notes editor** — TipTap, rich text, organisation, auth, persistence
2. **Real-time collaboration** — Yjs + Hocuspocus, live cursors, presence
3. **Per-cursor AI suggestions** — local ghost text, accept on Tab
4. **Ingestion + item generation** — PDF and notes → chunks → embeddings → cited review items
5. **Revision engine** — FSRS scheduling, confidence capture, misconception detection, exam mode _(new)_
6. **Testing sessions** — MCQ, cloze, short answer with LLM rubric grading
7. **Analytics dashboard** — mastery, calibration, misconceptions, forecast _(new)_
8. **AI teaching assistant** — grounded RAG with citations
9. **Quiz duels** — challenge by code, topic-based, LLM-graded

### Stretch (week 10 if ahead)

10. **Browser extension** — Chromium, highlight and clip to notes

Demoted from a scheduled deliverable because web-highlight anchoring on dynamic and lazy-loaded pages is a known-hard problem (fuzzy text-quote anchoring, SPA and infinite-scroll edge cases). It can quietly consume two weeks and produce nothing demoable. If the core is done and stable in week 10, spike it.

### Out of scope

- B2B layer (institute dashboard, doubt-solver on institute content, parent reports) — build only when a real institute asks
- Native OS overlay — separate product, shares no infrastructure
- Random stranger matchmaking — designed and documented, not built (§8)

---

## 5. The shared contract — frozen in week 1

This is the seam between the two tracks. It is agreed in week 1 and not renegotiated. Renegotiating the `items` schema in week 7 costs you both a week, not one of you half a week.

### Tables owned jointly

```
users(id, email, created_at, dob, parent_consent_at)
documents(id, user_id, title, yjs_state, plain_text, updated_at)
```

### One endpoint Track A must provide

```
GET  /internal/documents/:id/text  →  { doc_id, plain_text, version, updated_at }
```

Fired as a webhook on document change (debounced ~60s). Track B never needs to know Yjs exists.

### Tables owned by Track B, read by Track A

```
items(id, user_id, topic_id, type, prompt, answer, options, rubric,
      source_chunk_id, difficulty_seed, created_at)

review_log(id, item_id, user_id, reviewed_at, grade, confidence, correct,
           latency_ms, elapsed_days, context, scheduler_version)
```

`context` is one of `solo` | `duel` — that single column is what lets duels feed the scheduler for free.

### WebSocket convention

One connection per user, message envelope `{ type, payload, request_id }`. Track A owns the socket; Track B publishes to it by channel name. Used for ingestion-complete notifications and duel turn events alike.

### Working rule

**Neither track ever blocks the other.** Track A builds against stubbed endpoints returning fixture JSON. Track B tests against a plain `<textarea>` rather than waiting for TipTap. If either developer is ever waiting on the other, the contract is wrong — fix the contract, not the schedule.

---

## 6. Team split

### Track A — Workspace

TipTap editor · Yjs + Hocuspocus · presence and live cursors · ghost-text suggestions · duel realtime layer (lobby, turn state, live scoring) · all frontend including the review session and dashboard UIs.

Owns: the persistent runtime, the WebSocket layer, everything the user sees.

### Track B — Learning engine

Ingestion pipeline · item generation · FSRS scheduler and queue ranker · confidence and misconception logic · analytics aggregation · RAG retrieval · duel question sourcing and grading · RabbitMQ workers.

Owns: Postgres, pgvector, every LLM call, the evaluation harness.

Duels sit on Track A despite being a "learning" feature because A already stood up the persistent WebSocket runtime for Hocuspocus in week 2. Track B supplies the questions and the grading; Track A runs the match.

---

## 7. The revision engine

### 7.1 Review items

One `item` per source chunk, generated once and cached. Three types, in order of grading cost:

| Type           | Grading            | Notes                                       |
| -------------- | ------------------ | ------------------------------------------- |
| MCQ            | Free (exact match) | Default for early weeks and for duels       |
| Cloze deletion | Free               | Generated from the student's own note text  |
| Short answer   | LLM + rubric       | Best signal, highest cost — cap per session |

Every item stores `source_chunk_id`. This is load-bearing: it lets the teaching bot cite where an answer came from, and it turns a misconception into "you answered X, page 34 of your PDF says Y."

### 7.2 Confidence before the answer

Standard spaced repetition asks _how well did you recall that?_ after revealing the answer. That is a memory of a memory, and it is contaminated by having just seen the correct response.

Instead: **ask for confidence before revealing anything**, then grade correctness objectively. Two independent signals.

|                     | Correct                                | Incorrect                                                       |
| ------------------- | -------------------------------------- | --------------------------------------------------------------- |
| **High confidence** | Mastered — push interval out           | **Misconception** — top priority; they don't know they're wrong |
| **Low confidence**  | Fragile / lucky guess — don't trust it | Known gap — normal relearn                                      |

The top-right quadrant is the differentiator. "Confident and wrong" is precisely what burns students in exams, and no consumer flashcard app treats it as a distinct state. It drives the teaching bot, it drives queue priority, and it gives the dashboard a calibration metric.

UI: three buttons before reveal — _Sure_ / _Think so_ / _No idea_. Three levels, not five. More granularity is noise at this scale.

### 7.3 Scheduler

**Use FSRS (v6), not SM-2.** FSRS models each card with three variables — difficulty, stability, retrievability — where stability is how long the memory lasts before forgetting and rises with each successful review. SM-2 uses a single ease factor and gives every learner the same curve. Published benchmarks claim roughly 20–30% fewer reviews for the same retention.

Official implementations exist for TypeScript (`ts-fsrs`) and Python (`py-fsrs`) — you are integrating, not reimplementing.

**Implement SM-2 as well, behind the same interface.** This is not busywork; it is your evaluation chapter (§12).

```ts
interface Scheduler {
  next(state: CardState, grade: Grade, now: Date): CardState;
  retrievability(state: CardState, at: Date): number; // 0..1
  version: string;
}
```

The scheduler must be a **pure function** of `(card_state, grade, elapsed)`. No side effects, no DB reads inside it. This is what makes replay-and-compare possible at all, and it costs nothing to design that way from the start.

### 7.4 Signal → grade mapping

| Confidence         | Correct | FSRS grade    | Extra                                                                |
| ------------------ | ------- | ------------- | -------------------------------------------------------------------- |
| Sure               | ✓ fast  | Easy (4)      | —                                                                    |
| Sure               | ✓ slow  | Good (3)      | —                                                                    |
| Think so / No idea | ✓       | Hard (2)      | Never reward a guess                                                 |
| Think so / No idea | ✗       | Again (1)     | —                                                                    |
| **Sure**           | **✗**   | **Again (1)** | `misconception = true` → forced next-day review, overrides scheduler |

"Fast" and "slow" are relative to that student's own rolling median latency for that item type — not an absolute threshold. Log `latency_ms` from week 4 even though it isn't used until week 7.

### 7.5 Daily queue

Due-date filtering alone is not a revision engine. Rank the candidate pool:

```
priority = w1 · overdue_pressure          // days past due / stability
         + w2 · exam_proximity(topic)     // 0 if no exam set
         + w3 · misconception_flag        // hard boost
         + w4 · topic_weakness            // 1 - mean retrievability for topic
         + w5 · coverage_debt             // never-reviewed items
```

Then apply constraints:

- **Hard daily budget in minutes.** Students quit when the backlog explodes. This is the single most important constraint in the whole engine.
- **Mix:** ~60% due reviews / ~25% new items / ~15% misconception re-tests. Suppress new items when the due backlog exceeds the budget.
- **Interleave topics.** Do not block by topic. Interleaved practice beats blocked practice for retention — a citable finding, and a visible design decision in the report.

Weights start hand-tuned and constant. Tuning them is a documented next step, not a week-9 rabbit hole.

### 7.6 Exam mode

The student sets an exam date and in-scope topics. FSRS exposes `R(t)`, predicted probability of recall at any future time, so you can compute expected retrievability **on exam day** for every in-scope item and prioritise those projected to fall below target (default 0.9).

This flips the objective from _maximise long-term retention_ to _maximise recall on 12 November_. It is the exam-prep positioning from v0.1 made concrete, it is the strongest single thing in the demo, and Anki genuinely does not do it well.

---

## 8. Quiz duels

**Matchmaking is challenge-by-code, not random strangers.** A player generates a code or picks a classmate; both join a topic-scoped match.

Reasons, in order:

1. Random matchmaking demos as an empty lobby when the system has four users. A friend-code duel is something two developers can run live in front of an evaluator.
2. It removes the moderation queue, reporting flow, and rate limiting from the critical path.
3. It removes stranger-contact-with-minors from the DPDP exposure surface entirely (§13).

Random matchmaking is **designed and documented** in the report as the next step — the queue architecture written up without a half-built moderation system attached reads better than the reverse.

**Mechanics (MVP):** topic selected, 5 questions each drawn from the shared item bank, MCQ-only at first, live scoring over WebSocket. Every answer writes to `review_log` with `context = 'duel'`, so a duel is a revision session that happens to be competitive.

**If time allows:** each player authors one question. That path requires a moderation pass before the question reaches the opponent — non-negotiable. Skip the feature entirely rather than skip the moderation.

---

## 9. Teaching assistant

PDF and notes → chunks in pgvector → retrieve top-k → LLM with a pedagogy prompt (explain, then check understanding with a follow-up question).

**Grounded and cited is a requirement, not a nicety.** A hallucinated wrong answer in a study tool is a reputation problem, and in a graded project it is a demo failure. Every answer renders its source chunks. If retrieval returns nothing above the similarity threshold, the bot says it doesn't know rather than improvising.

Primary entry point is a misconception in the dashboard: _"You were confident that X. Here's what your notes actually say."_ That single flow ties the teaching bot to the revision engine instead of leaving it as a detached chatbot.

---

## 10. Analytics dashboard

Five panels, all computed from `review_log`:

1. **Topic mastery heatmap** — mean predicted retrievability per topic, weighted by item count
2. **Calibration curve** — confidence bucket vs actual accuracy, with Brier score and an over/under-confidence verdict
3. **Misconception list** — high-confidence wrong answers, each linked to its source chunk and to the teaching bot
4. **Retention forecast** — projected recall to exam day, plus the daily item count needed to hit target
5. **Workload forecast** — due-count over the next 14 days

Panel 2 is the one nobody else has. Lead the demo with it.

---

## 11. Architecture

### Stack (unchanged from v0.1)

| Layer    | Choice                                                         |
| -------- | -------------------------------------------------------------- |
| Frontend | Next.js + TypeScript + Tailwind                                |
| Editor   | TipTap (ProseMirror)                                           |
| Collab   | Yjs (CRDT) + Hocuspocus                                        |
| Database | Postgres                                                       |
| Vectors  | pgvector                                                       |
| LLM      | Single swappable provider interface                            |
| Auth     | Off-the-shelf (Clerk / Auth.js / Supabase)                     |
| Queue    | RabbitMQ                                                       |
| Runtime  | Persistent (Railway / Fly / Render / VPS) — **not** serverless |

### Non-negotiable gotchas

- **Serverless is fine for the Next.js app, fatal for WebSockets.** Hocuspocus and the duel server need a persistent process.
- **Ghost text never enters the Yjs document.** It is a local editor decoration. Write it into the shared doc and every collaborator sees everyone else's suggestions.
- **Per-cursor suggestions need no server coordination.** Each client generates locally for its own cursor. The hard part is cost, not concurrency.
- **The scheduler is pure.** No DB access inside `Scheduler.next()`.

### Message queue

Queues belong in background work only — never in Yjs sync, ghost text, or live duel exchange. Adding a queue to a realtime path adds latency and breaks the feel.

Where it earns its place:

- **Ingestion pipeline** (the flagship): upload returns instantly, worker parses → chunks → embeds → writes pgvector → notifies over the existing WebSocket
- **Batch item generation** from a topic or a note
- **Async short-answer grading** when it exceeds a second or two

The ingestion worker exercises the entire model in one feature: producer, exchange, consumer, ack, retry, dead-letter queue, idempotency. Build that first (week 10), everything else is a variation.

### Cost control — day one, not later

- Debounce ghost text on pause and paragraph boundary, never on keystroke
- Cap surrounding context window per suggestion
- Generate items once per chunk, cache, dedupe by embedding similarity
- MCQ and cloze grade for free; cap short-answer per session
- Hard per-user daily LLM budget, enforced server-side

Per-cursor suggestions are the worst offender by an order of magnitude. Instrument cost per user per day from week 4.

---

## 12. Evaluation plan (for the report)

This is where the project earns marks beyond "it works."

1. **Scheduler comparison.** Replay the same `review_log` through FSRS and SM-2. Report predicted vs actual recall, log loss, RMSE per bin. This is why the scheduler is pure and the log is append-only.
2. **Calibration analysis.** Brier score across the user base. Does confidence-aware scheduling reduce high-confidence errors over time compared to a confidence-blind baseline?
3. **Misconception recovery.** Of items flagged as misconceptions, what fraction are answered correctly with high confidence at the next two reviews?
4. **Cost per active student per day.** A real engineering result, and the one your v0.1 doc correctly identified as existential.

Real user data will be thin over a semester. Two mitigations: seed with simulated students drawn from known forgetting-curve parameters, and recruit ~10–20 classmates for two weeks in weeks 9–11. State the limitation plainly in the report rather than overclaiming.

---

## 13. Legal — India DPDP Act

Load-bearing if you put this in front of real students.

- A **child is anyone under 18** — uniform threshold, stricter than GDPR/COPPA
- **Verifiable parental consent** required to process a child's data; self-declared age is explicitly insufficient
- **Absolute prohibition** on behavioural tracking and targeted advertising directed at children — cannot be unlocked by consent
- Penalties up to **₹200 crore**; they apply to a two-person project the same as to a company

**Practical implications for the MVP:**

- Collect DOB at signup. Gate anything social behind an adult flag or recorded consent.
- No behavioural analytics beyond what the student sees in their own dashboard.
- No ads, ever.
- Challenge-by-code matchmaking (§8) is partly a legal decision, not only a scope one.

_Not legal advice. Confirm before any public launch._

---

## 14. Thirteen weeks

| Week | Track A — Workspace                                                        | Track B — Learning engine                                     |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1    | **Contract frozen.** Auth, deploy pipeline live, TipTap single-user editor | **Contract frozen.** Postgres + pgvector, PDF upload, storage |
| 2    | Yjs + Hocuspocus, state persistence to Postgres                            | Parse → chunk → embed pipeline (synchronous)                  |
| 3    | Presence, live cursors, document organisation                              | LLM item generation, topic tagging, source citations          |
| 4    | Ghost text: debounce, trigger, stream, Tab accept                          | Review session API, `review_log` writes, latency capture      |
| 5    | Ghost-text cost control, caching, per-user caps                            | FSRS + SM-2 behind one interface, `card_state`                |
| 6    | Review session UI                                                          | Queue ranker: budget, mix, interleaving                       |
| 7    | Duel lobby, friend codes, turn state machine                               | Confidence mapping, misconception flag, exam mode             |
| 8    | Duel UI, live scoring                                                      | Analytics aggregation endpoints                               |
| 9    | Dashboard UI, RAG chat UI, citation rendering                              | RAG retrieval + pedagogy prompt, duel grading                 |
| 10   | Extension spike _(stretch)_                                                | RabbitMQ: ingestion + item-gen move to workers                |
| 11   | **Integration + evaluation harness — both tracks**                         |                                                               |
| 12   | **Polish, seed data, demo script, report — both tracks**                   |                                                               |
| 13   | **Buffer**                                                                 |                                                               |

**Week 11 is real work, not a formality.** Two independently-working halves do not add up to one working system on the first attempt. Budgeting zero time for integration is the most common way a two-person semester project ships broken.

**Move RabbitMQ to week 5** if learning message queues is a graded objective rather than a personal one. It is not on the demo critical path, which is why it otherwise lands at week 10.

---

## 15. Risks

| Risk                              | Mitigation                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| Contract renegotiated mid-project | Freeze week 1; changes require both developers to agree in writing                          |
| One track blocks the other        | Stubs and fixtures on both sides from week 1                                                |
| Integration surprises in week 11  | Deploy both tracks continuously from week 1; never a long-lived branch                      |
| LLM cost overrun                  | Caps enforced server-side from week 4, instrumented per user per day                        |
| LLM grading feels unfair          | MCQ and cloze first; short answer with explicit rubrics, and show the rubric to the student |
| Hallucination in the teaching bot | Grounded RAG only; refuse below similarity threshold                                        |
| Thin evaluation data              | Simulated students + a 2-week classmate cohort in weeks 9–11                                |
| Extension eats two weeks          | It is a stretch goal with a hard stop, not a deliverable                                    |

---

## 16. Open decisions

1. **Backend shape** — standalone service from day one, or Next.js API routes with the realtime service split out at week 2. (Recommendation: split at week 2, since Track A needs the persistent runtime anyway.)
2. **LLM provider** — cost vs quality, behind the swappable interface either way.
3. **Queue weights** — `w1..w5` in §7.5 start hand-tuned; decide whether tuning them is in scope for week 12 or a documented next step.
4. **Free/paid line** — out of scope for the semester, but worth a paragraph in the report.

---

## References

- FSRS algorithm and implementations — https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler
- Open Spaced Repetition (ts-fsrs, py-fsrs) — https://open-spaced-repetition.github.io/
- India DPDP Act, children's data (Section 9) — https://www.dpdpindia.in/dpdp-children.html
- Classplus business model / pivot context — https://inc42.com/features/classplus-flips-its-edtech-playbook/

_Verify legal specifics with a qualified lawyer. Market and competitor details change over time._
