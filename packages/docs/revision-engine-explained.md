# The Revision Engine — From First Principles

> A from-scratch teaching walkthrough of the revision engine described in `mvp-spec-v0.2.md` §7. Covers the theory (why spaced repetition works at all), the mechanics (SM-2, then FSRS, worked by hand with real numbers), the product-specific layer (confidence-before-reveal, misconception detection), the ranking system (the daily queue), exam mode, and how it all gets built as a real system across the 13-week plan.

---

## 1. The problem this engine solves

You forget things over time, and not at a constant rate. Hermann Ebbinghaus measured this on himself over a century ago: recall probability drops steeply at first, then the drop flattens out. This is the **forgetting curve**.

```
Recall probability
100% |\
     | \
     |  \___
     |      \______
     |             \__________
  0% |________________________________ time
     0    1 day   1 week   1 month
```

**Insight 1 — the spacing effect.** If you review a fact _right before you'd have forgotten it_, the successful retrieval near the edge of failure makes the memory stronger and slower to decay next time. Reviewing something you already remember perfectly, or re-reading instead of testing, does much less for retention than testing right at the edge.

**Insight 2 — the optimal review time is different for every fact, and changes as the memory strengthens.** Easy, well-known facts need reviewing rarely. New or hard facts need reviewing often. Review too early and you waste time; review too late and you've already forgotten and have to relearn from scratch.

**The core problem a revision engine solves:** out of everything a student has ever learned, across hundreds of notes and PDFs, _what specific facts are sitting right at the forgetting edge today_ — found automatically, per student, per fact, without the student guessing.

Everything else in this document — FSRS, confidence buttons, misconceptions, exam mode — is refinement on top of this one idea: **predict, for each fact, when the student is about to forget it, and show it to them right before that happens.**

---

## 2. Modeling one fact's memory — "card state" and SM-2

To predict forgetting per-fact in software, you need to store something per fact, per student, representing the current state of that memory — called **card state** (term borrowed from Anki).

Minimum needed:

1. When was it last reviewed (timestamp)
2. How long to wait until the next review (an interval)
3. Some number representing "how well known is this," so the interval can grow as it solidifies and shrink if forgotten

### SM-2 (1987) — the original algorithm, still what Anki mostly uses

Three numbers per card:

| Field         | Meaning                                                     |
| ------------- | ----------------------------------------------------------- |
| `repetitions` | how many times in a row answered correctly                  |
| `interval`    | days until next review                                      |
| `ease_factor` | multiplier, starts at 2.5 — "how easy this card is for you" |

**The loop, every review:**

1. Student self-rates recall quality 0–5, **after** seeing the correct answer.
2. Rating < 3 (failed): `repetitions = 0`, `interval = 1 day` — start over.
3. Rating ≥ 3 (succeeded): `repetitions += 1`; interval grows — 1st success → 1 day, 2nd → 6 days, every success after → `interval = interval × ease_factor`; `ease_factor` nudges up/down based on the rating.

A card you keep nailing: 1 → 6 → 15 → 37 → 92 days (compounding). A card you keep failing stays stuck at 1 day.

**Why it's limited:**

- One `ease_factor` conflates "this card is inherently hard" with "I currently remember it well" — two different things squashed into one number.
- Same growth pattern shape for every student; doesn't model _personal_ forgetting speed.
- Only outputs a next interval, not a probability — can't answer "what's my % chance of recalling this on a specific future date." No continuous forgetting curve to query. This is exactly the gap FSRS was built to close, and exactly what exam mode (§8 below) needs.

---

## 3. Detour Q&A — three foundational doubts, answered

### Why per-fact, not per-topic?

A topic like _Newton's Laws_ isn't one memory — it's a bundle of separately-recallable pieces (three laws, formulas, edge cases). Scheduling at topic granularity can only say "this topic is due" as one blob; it can't tell you _which piece_ is about to be forgotten, so it either over-reviews what's already solid or lets one weak piece hide inside a topic that looks fine on average.

This is why spaced-repetition systems always operate on the smallest independently-recallable unit ("atomizing" knowledge) — you can only measure and schedule forgetting at the granularity you test at.

Topic doesn't disappear — it moves up a layer. The `items` table carries `topic_id`; scheduling happens per-item, but topic is the _aggregation_ layer: `topic_weakness = 1 - mean retrievability for topic` (used in the queue formula, §7 below) and the mastery heatmap are both built by aggregating item-level retrievability upward. Fact is the unit of measurement; topic is the unit of reporting.

Honest caveat: auto-generating atomic items from a student's own notes is a real quality risk — a cloze deletion pulled out of context can become ambiguous. This is a genuine open problem, not a solved one.

### Self-rating vs. AI grading — two different mechanisms, not one

1. **Correctness** — objective, never self-rated. MCQ/cloze graded by exact match (free); short answer graded by an LLM against a rubric.
2. **Confidence** — self-rated on purpose, collected _before_ reveal.

Confidence is a report of the student's internal metacognitive state — an AI can't measure "did I feel sure" from the outside without becoming a different, less useful signal (a proxy for belief instead of the belief itself). The whole calibration metric and misconception detector depend on comparing what the student _believed_ against what was actually true — replacing self-report with an AI's guess defeats that.

SM-2 mixes these up: it asks for a self-rating _after_ seeing the answer, which is contaminated (you just saw it, so your rating is biased). This spec's fix — confidence before reveal, correctness graded independently after — is what makes the "confident but wrong" quadrant detectable at all.

### Is SM-2 "good enough"? What's actually novel here?

SM-2 is genuinely fine for basic spacing (it's run Anki for over a decade). Its ceiling: it can't answer "probability I recall this specific fact on a specific future date" — no continuous curve, just a next-interval output. FSRS's difficulty/stability/retrievability split gives you `R(t)`, queryable at any future date — which is exactly what exam mode needs.

Precision on novelty:

- **FSRS itself is not novel** — an existing published algorithm with existing libraries (`ts-fsrs`/`py-fsrs`). You integrate it, you don't reimplement it.
- **The novel part is the product-level combination:** confidence-before-reveal crossed with objective correctness to catch "confident and wrong" as a distinct state (no consumer flashcard app treats this as its own thing); reframing the scheduler around a fixed exam date instead of generic long-term retention; feeding duels, the teaching bot, and analytics off one shared log.
- **The SM-2 vs. FSRS comparison is itself the evaluation chapter** (§12 of the spec) — implementing "the worse one" on purpose, behind the same interface, so real review data can be replayed through both and compared. That comparison is where the project earns marks, not the FSRS integration alone.

---

## 4. FSRS — modeling memory with three numbers instead of one

SM-2 crammed "how hard is this fact" and "how well do I currently remember it" into one `ease_factor`. FSRS's key move: track those as two separate variables.

### The three variables

**Difficulty (D)** — how inherently hard this fact is _for this student_, roughly 1–10. Slow-moving; barely shifts after any single review, drifts based on the pattern of grades over time.

**Stability (S)** — how many days it currently takes for recall probability to drop to ~90%. This is what actually drives scheduling. Grows every successful recall (the spacing effect, now numeric); collapses sharply on failure.

**Retrievability (R)** — the probability, right now (or at any chosen future time), that the student would recall the fact. Not stored — computed on demand:

```
R(t) = probability of recall, t days after last review, given current stability S
```

As `t` grows relative to `S`, `R` falls. Because this is a formula you can evaluate at _any_ future `t`, not just "the next review date," it's what makes exam mode possible: plug in `t = days until exam day` for every item and get a predicted recall probability for that specific date.

### Why separating D and S matters

Two cards can share stability (both "forgotten in 3 days") with very different difficulty. A low-difficulty card at 3-day stability probably needs one or two more reviews to jump to a long stability. A high-difficulty card at the same stability needs many more — it's inherently leaky. FSRS uses difficulty to control _how much stability grows per successful review_ (easy cards get bigger jumps from the same grade than hard cards). SM-2's single ease factor can't express this.

### The update loop, conceptually

Four grade levels every review — Again(1) / Hard(2) / Good(3) / Easy(4):

- **Again:** stability drops sharply (relearning, not reviewing); difficulty ticks up slightly.
- **Hard:** stability grows a little.
- **Good:** stability grows by a solid multiple — the normal successful-review case.
- **Easy:** stability grows the most.

The growth multiplier isn't a hand-picked constant — it's a function of current stability, difficulty, _and_ retrievability at the moment of review (recalling something right at the forgetting edge produces a bigger stability jump than recalling something reviewed an hour ago). This is the mechanism behind FSRS's published 20–30% fewer-reviews result: it squeezes more stability growth per review by reviewing closer to the actual forgetting edge, made possible because `R(t)` is a real formula, not a guess.

### The interface (from the spec, §7.3)

```ts
interface Scheduler {
  next(state: CardState, grade: Grade, now: Date): CardState;
  retrievability(state: CardState, at: Date): number; // 0..1
  version: string;
}
```

- `CardState` = `{ difficulty, stability, last_review_at, reps, ... }`.
- `next()` = the update loop above.
- `retrievability()` = the forgetting-curve formula, evaluable at any date — what exam mode calls with `at = exam_date`.
- `version` exists because SM-2 gets implemented behind this _same_ interface, so the evaluation chapter is just: run the same `(card_state, grade, elapsed)` sequence through two different `next()` implementations and compare.

**Why "pure function, no DB reads inside it" is load-bearing, not a style preference:** replaying history through a scheduler only works if `next()` always returns the same output for the same input, and never silently reaches into today's date or database. If it did, you could never faithfully replay old review logs through a _different_ scheduler to compare — which is exactly what the evaluation chapter depends on.

---

## 5. Worked example — one card's life, with real numbers

_(Illustrative round numbers, not `ts-fsrs`'s actual ~19 trained parameters — built to show the mechanism, not to be copied into code.)_

**Retrievability formula used:** `R(t, S) = (1 + t / (9·S))^-1`. Check: at `t = S`, `R = (1 + 1/9)^-1 = 0.9` — exactly matches the definition "S is the number of days until R drops to 90%."

Card: _"Capital of Australia is Canberra."_

**Day 0 — first review, grades "Good".** No prior state; initial values for first-time "Good": `D = 5.0`, `S = 3.2 days`. Next review scheduled ~day 3 (where R will have dropped to ~90%).

**Day 3 — due.** `R(3, 3.2) = (1 + 3/28.8)^-1 ≈ 0.906` (~91% — matches "due around 90%"). Student answers correctly, confidently → **Good** again.

- Stability jumps (successful recall right near the forgetting edge = strong reinforcement): `S → 9 days`.
- Difficulty barely moves: `D → 4.8`.
- Next review ~day 12.

**Day 12 — due.** `R(9, 9) = (1 + 9/81)^-1 = 0.9` exactly. Student blanks → **Again**.

- Stability collapses (not all the way to the first value — some residual learning survives): `S → 1.5 days`.
- Difficulty rises: `D → 6.5`.
- Next review ~day 13.5.

| Day | Grade           | R just before answering | D after | S after | Next due |
| --- | --------------- | ----------------------- | ------- | ------- | -------- |
| 0   | Good (new card) | —                       | 5.0     | 3.2     | day 3    |
| 3   | Good            | 0.906                   | 4.8     | 9.0     | day 12   |
| 12  | Again           | 0.900                   | 6.5     | 1.5     | day 13.5 |

**Takeaways:**

- `R` is never stored — recomputed on the fly from `(S, t)`. This is why exam mode can ask "what's R on exam day" for every card in one pass, without changing how the card is stored.
- `D` and `S` move somewhat independently — a failure pushes `D` up _and_ crashes `S`; a success mostly grows `S`, barely touching `D`. That decoupling is why FSRS beats a single ease-factor model: "intrinsically hard but currently fragile" is two facts SM-2 can't represent separately.

---

## 6. Confidence-before-reveal and misconception detection

### The flow, in order

1. Show the question. Student picks **Sure / Think so / No idea** — _before_ seeing the answer.
2. Student answers.
3. System grades correctness objectively (never self-reported).
4. Cross the two independent bits: what they believed, and what was true.

### The 2×2 grid

|                                         | **Correct**     | **Incorrect**     |
| --------------------------------------- | --------------- | ----------------- |
| **High confidence (Sure)**              | Mastered        | **Misconception** |
| **Low confidence (Think so / No idea)** | Fragile / lucky | Known gap         |

Three quadrants behave as any spaced-repetition system would expect. The fourth — **confident and wrong** — is new: a student who would write the wrong answer on an exam _without hesitation_, because as far as they know they're right. Nothing about _how_ they answered (fast, no visible hesitation) flags this; only crossing confidence against truth reveals it.

### Worked example

**Scenario A — honest gap.** "No idea" (low confidence) → answers "Perth" → wrong.
→ Grade = **Again (1)**. Normal relearn, no misconception flag — they knew they didn't know.

**Scenario B — the dangerous case.** "Sure" (high confidence) → answers "Perth" → wrong.
→ Grade = **Again (1)**, _same grade as Scenario A_ — but **`misconception = true`** is set. This flag does something the FSRS math alone never would.

### What the misconception flag actually does — two separate layers

1. **FSRS layer:** sees `grade = Again`, updates `D`/`S` exactly as any failure would — identical to Scenario A.
2. **Queue-priority layer** (separate from scheduling math): reads the `misconception` boolean and **forces this item into tomorrow's queue regardless of what S implies its natural next-due date should be**, plus a hard priority boost (`w3 · misconception_flag` in the ranking formula, §7 below).

Same scheduler math, different downstream urgency: the FSRS update answers "how should this card's long-term trajectory change." The misconception flag answers a separate question — "does this wrong belief need correcting _immediately_, before it calcifies or shows up on an exam."

### The full signal → grade mapping table

| Confidence         | Correct | FSRS grade    | Extra                                                               |
| ------------------ | ------- | ------------- | ------------------------------------------------------------------- |
| Sure               | ✓, fast | Easy (4)      | Big stability jump — knew it, effortless                            |
| Sure               | ✓, slow | Good (3)      | Knew it, took real effort                                           |
| Think so / No idea | ✓       | Hard (2)      | _Never reward a guess_ — correct but low confidence caps the credit |
| Think so / No idea | ✗       | Again (1)     | Normal relearn                                                      |
| **Sure**           | **✗**   | **Again (1)** | `misconception = true` → forced next-day, overrides scheduler       |

"Never reward a guess": a low-confidence correct answer only earns Hard, not Easy/Good — otherwise a lucky guess could inflate stability and the card would silently drift toward under-review. Confidence acts as a discount on correctness, not an independent label.

### Fast vs. slow — relative, not absolute

"Fast"/"slow" is relative to _that student's own rolling median latency for that item type_ — not an absolute cutoff. Different students type/read at different speeds; different item types (MCQ vs. short answer) have different natural response times. `latency_ms` is logged from week 4, even before this logic uses it, so weeks of history exist before "relative to median" means anything.

### Where it all lands

Every review writes one row to `review_log`: `(item_id, user_id, reviewed_at, grade, confidence, correct, latency_ms, elapsed_days, context, scheduler_version)`. That row drives the FSRS update, the misconception queue override, the calibration curve/Brier score on the dashboard, and — because `context` is `solo` or `duel` on the same schema — a duel answer produces an identical row and feeds the exact same scheduler for free.

---

## 7. The daily queue — ranking and budgeting what to show today

Due-date filtering alone isn't enough — on a bad day dozens of items could all be "due," and showing all of them would take an hour and the student would quit. The queue's job: pick the best-ordered, time-bounded list for _right now_.

### Step 1 — score every candidate

```
priority = w1 · overdue_pressure
         + w2 · exam_proximity(topic)
         + w3 · misconception_flag
         + w4 · topic_weakness
         + w5 · coverage_debt
```

- **`overdue_pressure = days_past_due / stability`** — overdue relative to how fragile that memory currently is, not a flat day count.
- **`exam_proximity(topic)`** — 0 if no exam set, rises as the exam date nears.
- **`misconception_flag`** — the boolean from §6; weighted to dominate most ties.
- **`topic_weakness = 1 - mean retrievability for topic`** — boosts items from topics that are weak on average, not just individually overdue items.
- **`coverage_debt`** — never-reviewed items get a boost so new material isn't permanently starved by an ever-growing due backlog.

### Worked example

Exam on Thermodynamics in 5 days. Weights `w1=1, w2=2, w3=5, w4=1, w5=0.5`:

| Item | Topic        | overdue_pressure | exam_proximity | misconception | topic_weakness | coverage_debt | **Priority** |
| ---- | ------------ | ---------------- | -------------- | ------------- | -------------- | ------------- | ------------ |
| B    | Thermo       | 10/2 = 5.0       | 0.6            | 0             | 0.3            | 0             | **6.5**      |
| C    | Optics       | 0                | 0              | 1             | 0.6            | 0             | **5.6**      |
| A    | Thermo       | 2/4 = 0.5        | 0.6            | 0             | 0.3            | 0             | **2.0**      |
| E    | Thermo       | 0                | 0.6            | 0             | 0.3            | 0             | **1.5**      |
| F    | Optics       | 0.2              | 0              | 0             | 0.6            | 0             | **0.8**      |
| D    | Optics (new) | 0                | 0              | 0             | 0              | 1             | **0.5**      |

Ranked: B → C → A → E → F → D. Item B (catastrophically overdue relative to its own fragile stability) wins even over a flagged misconception C — the formula working correctly, not misconception blindly winning regardless of scale.

### Step 2 — constraints on top of the ranking

1. **Hard time budget.** E.g., 15 minutes ÷ ~1.5 min/item ≈ 10-item cap, regardless of how many are technically due. Called out as _the single most important constraint in the whole engine_ — an unbounded backlog is what makes students quit.
2. **Mix ratio: ~60% due / 25% new / 15% misconception retest**, applied within the cap.
3. **Backlog override:** if due-review items alone exceed the whole budget, suppress new items entirely — dig out of backlog before adding to it.

### Step 3 — interleave, don't block

Present the chosen items with topics alternating (`Thermo → Optics → Thermo → Optics...`), not grouped by topic. Interleaved practice beats blocked practice for long-term retention — a citable, deliberate design choice.

### Honest caveat

`w1..w5` are hand-picked constants, not learned. Tuning them against real outcomes is a documented next step, not an in-scope deliverable for this semester.

---

## 8. Exam mode — same machinery, different objective

Everything above optimizes for _indefinite_ retention. Exam mode re-targets the same model toward: maximize recall on one specific future date, regardless of what happens to memory afterward.

### Mechanism

For every in-scope item: `R_exam = retrievability(item_state, at = exam_date)` — literally the same `retrievability(state, at)` method from §4, with `at` fixed to the exam date instead of "now."

### Worked example

Today = day 0, exam = day 20. Three items, each just reviewed:

| Item | S   | R at exam day = `(1 + 20/(9·S))^-1` | vs. 0.9 target   |
| ---- | --- | ----------------------------------- | ---------------- |
| X    | 25  | (1+20/225)⁻¹ = **0.918**            | safe             |
| Y    | 6   | (1+20/54)⁻¹ = **0.730**             | below target     |
| Z    | 3   | (1+20/27)⁻¹ = **0.574**             | far below target |

Turn the gap into urgency: `exam_urgency = max(0, target - R_exam)` → X: 0, Y: 0.170, Z: 0.326. This feeds `w2 · exam_proximity(topic)` in the queue formula, now precise per-item instead of a coarse per-topic constant — Z and Y get pulled forward even if their normal due dates wouldn't have surfaced them yet.

This recomputes continuously: as exam day nears, `t` shrinks and `R_exam` drifts up for everything; every real review that reinforces Y or Z grows their `S`, which lowers urgency automatically. No manual re-tuning.

### Why this is the strongest demo point

A normal scheduler can say "due in 6 days." It cannot answer "probability I recall this specific fact on a specific future date" — no continuous curve to query, just a next-interval output. FSRS's `retrievability(state, at)` exists because it models a real curve, so pointing it at a fixed exam date instead of "now" is nearly free once the scheduler exists — and it's a capability mainstream tools (including Anki) don't offer. The same computation, aggregated, is dashboard panel 4: "projected recall to exam day, plus daily item count needed to hit target."

---

## 9. The end-to-end system

### The flow

```
1. INGESTION
   PDF / notes upload
        ↓
   Worker: parse → chunk → embed → store in pgvector
        ↓
2. ITEM GENERATION
   LLM reads each chunk → generates MCQ / cloze / short-answer items
   Stores: prompt, answer, topic_id, source_chunk_id
   Generated ONCE per chunk, cached — never regenerated per session
        ↓
3. DAILY QUEUE (§7)
   Ranker reads items × each item's card_state × exam settings
   → priority formula → budget/mix/interleaving → today's session list
        ↓
4. REVIEW SESSION (§4, §6, per item)
   Confidence captured BEFORE reveal → answer → objective grading
   → confidence × correctness → FSRS grade (+ maybe misconception=true)
   → scheduler.next(card_state, grade, now) → new card_state
   → one row written to review_log
        ↓
5. FAN-OUT from review_log
   → card_state update (drives tomorrow's queue)
   → analytics aggregation (dashboard)
   → misconception → teaching bot trigger
   → identical path for duels, context='duel' instead of 'solo'
        ↓
6. EXAM MODE (§8) — read-only
   retrievability(state, at=exam_date) over in-scope items
   → feeds queue priority AND dashboard retention-forecast panel
   → writes nothing; a query over state steps 1–5 already produced
```

Nearly the whole system is either producing `review_log` rows or reading them.

### Where does `card_state` actually live?

The spec gives `items` and `review_log` as tables — no explicit `card_state` table, deliberately. Two valid approaches:

- **Materialize it** — store current `(difficulty, stability, last_review_at)` per `(user, item)`, updated in place each review. Fast for daily queue reads.
- **Derive it on demand** — treat `review_log` as sole source of truth, reconstruct `card_state` by replaying every past review through `scheduler.next()` in order.

Production wants the materialized version for speed — but the _reason_ the scheduler is a pure function with no side effects is so both are always possible and always agree; the materialized table is just a cache of the replay. This equivalence is what makes the evaluation chapter work: take the same `review_log` history, replay once through FSRS's `next()` and once through SM-2's, compare trajectories — no need for two live systems running in parallel.

### Mapping onto the 13-week build order

The build order does **not** follow the conceptual teaching order — data capture is built before the "real" scheduler exists:

| Week | What gets built                                              | Note                              |
| ---- | ------------------------------------------------------------ | --------------------------------- |
| 1    | Postgres + pgvector, PDF upload/storage                      | Just storage                      |
| 2    | Parse → chunk → embed, **synchronous**                       | No queue yet — make it work first |
| 3    | LLM item generation, topic tagging, citations                | `items` table fills               |
| 4    | Review session API, `review_log` writes, **latency capture** | Logging starts before FSRS exists |
| 5    | FSRS + SM-2 behind one interface, `card_state`               | §4's machinery                    |
| 6    | Queue ranker: budget, mix, interleaving                      | §7's machinery                    |
| 7    | Confidence mapping, misconception flag, exam mode            | §6 & §8's machinery               |
| 8    | Analytics aggregation endpoints                              | Dashboard backend                 |
| 9    | RAG retrieval + pedagogy prompt, duel grading                | Teaching bot, duels               |
| 10   | RabbitMQ: ingestion + item-gen → async workers               | Step 1 above, now async           |
| 11   | Integration + evaluation harness                             | Both tracks converge              |
| 12   | Polish, seed data, demo script, report                       |                                   |
| 13   | Buffer                                                       |                                   |

Two deliberate choices worth remembering:

1. **Logging (week 4) starts three weeks before confidence/misconception logic (week 7).** The evaluation chapter needs weeks of real review history to mean anything, and real user data is already thin (§12 recommends recruiting classmates for two weeks in weeks 9–11). Every delayed week of logging is evaluation data that can't be recovered — so capture-first, intelligence-second.
2. **Ingestion is synchronous in week 2, rebuilt async with RabbitMQ in week 10.** No message queue is needed to prove parsing/chunking/embedding works — only to prove the system survives a slow LLM call without blocking the user. Building synchronous first means weeks 3–9 have real data to build against instead of waiting on queue infrastructure. Same instinct as "stub the contract, don't block on it" (§5's working rule in the spec).

### Ownership

Almost the entire revision engine — ingestion, items, scheduler, queue, confidence/misconception, analytics, exam mode — is **Track B**. Track A's involvement is the review session UI and dashboard UI: the windows into the engine, not the engine itself.

---

## Where to go next

Two natural continuations from here:

- **The evaluation chapter (§12 of the spec)** — how to actually write up the FSRS-vs-SM2 replay comparison, calibration/Brier score analysis, misconception recovery rate, and cost-per-student — this is where the project earns marks beyond "it works."
- **Hands-on** — write a toy implementation of the `Scheduler` interface in code and run the Chunk-5 worked example through it for real, instead of by hand.
