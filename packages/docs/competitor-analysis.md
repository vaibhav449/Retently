# Competitor Analysis — AI-Native Collaborative Study Workspace

> Research conducted September 2026. Covers spaced-repetition tools, note-taking apps with AI layers, and one reference product (Duolingo) chosen for its gamification/social design rather than as a direct competitor. Every claim below is sourced; items that could not be verified are explicitly flagged rather than guessed at — treat those as needing a direct re-check before quoting in a report.

---

## Why this analysis, and what we're checking for

Our project's claimed differentiators, from the MVP spec, are:

1. **FSRS-based scheduling** (difficulty/stability/retrievability) rather than the older SM-2
2. **Confidence captured before the answer is revealed**, crossed against objective correctness, to detect a **"confident but wrong" misconception** as its own distinct state
3. **Exam-date-targeted scheduling** — predicted recall probability for a _specific future date_, not just "review again in N days"
4. **AI-generated notes from rough material** (PPTs, screenshots, scanned PDFs) plus AI-generated quiz items, both cited back to source
5. **A calibration curve** (confidence vs. actual accuracy) as a dashboard artifact
6. **Quiz duels** and other social features built on the same underlying review data

The point of this research was to find out, honestly, which of these already exist elsewhere — not to assume they don't.

---

## Cross-cutting finding

**Across all 10 products researched, none implement a pre-answer confidence rating combined with a "confident-but-wrong" misconception signal distinct from plain incorrectness, and none surface a calibration curve as a dashboard artifact.** Every SRS-adjacent product found (Anki, RemNote, the Obsidian plugin, Mochi, SuperMemo) only captures a **post-answer** difficulty/recall self-report (e.g. Again/Hard/Good/Easy or Remembered/Forgot) — a fundamentally different signal from a pre-answer confidence judgment.

Two close analogs are worth naming honestly rather than claiming a clean gap:

- **SuperMemo's Forgetting Index** and collection-wide retention statistic is the closest existing thing to a "retention forecast" — but it's a whole-collection average, not a per-item calibration curve.
- **RemNote's Exam Scheduler** is the closest existing thing to exam-date-targeted scheduling — but it works by pacing new cards and forcing a final review pass before the date, not by displaying an explicit predicted-recall-probability number for that date.

Both are genuine, defensible differentiators for this project, but they should be framed in the report as _"no product found doing exactly this"_ rather than _"no product could possibly do this"_ — this space ships new features every few weeks (NotebookLM went from zero study features to flashcards+quizzes in about two months in late 2025).

---

## Product profiles

### 1. Anki (+ AnkiDroid / AnkiWeb)

**What it is:** Free, open-source, flashcards-only SRS app — no notes editor.
**Algorithm:** Supports both **SM-2** (default) and **FSRS** (opt-in since v23.10, Nov 2023) — FSRS is still not the default as of 2026, users must enable it manually. FSRS reduces reviews ~20–30% for equal retention, per benchmarks on 500M+ real reviews.
**Notes+SRS combined:** No — cards are authored separately from any notes.
**AI features:** None in core app.
**Confidence/misconception tracking:** None — post-answer Again/Hard/Good/Easy only.
**Exam-date targeting:** Not found.
**Collaboration:** AnkiWeb Shared Decks (one-way publish, not live collab). Anki's own FAQ admits collaboration support is "limited." Real collaboration is filled by third-party tools (AnkiHub, AnkiCollab). No dueling.
**Pricing:** Desktop/Android/sync free; iOS app is a one-time $24.99 purchase, no subscription.
**Sources:** [Anki FAQ: algorithm](https://faqs.ankiweb.net/what-spaced-repetition-algorithm) · [FSRS4Anki Wiki](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm) · [Anki FAQ: collaboration](https://faqs.ankiweb.net/how-can-i-work-with-someone-else-to-create-a-deck.html)

### 2. Quizlet

**What it is:** Mass-market flashcard/study-set platform (60M+ monthly users), optimized for short-term cramming over long-term retention.
**Algorithm:** "Learn" mode is **not** true interval-based SRS — it's a session-level adaptive ML model (originally logistic regression) that resurfaces missed cards within a session. Quizlet's own engineers found 95% of users study a set over 4 days or fewer, which is why the product leans cram-optimized rather than long-interval. Does not implement SM-2 or FSRS.
**Notes+SRS combined:** No (though Magic Notes ingests notes, see below).
**AI features:** **Magic Notes** (notes/PDF → outlines, flashcards, practice tests, summaries); **Expert Solutions** (AI textbook answers). **Q-Chat**, its AI tutor, was discontinued around June 2025.
**Confidence/misconception tracking:** Not found.
**Exam-date targeting:** Not found.
**Collaboration:** **Quizlet Live** — real-time classroom game, join by code, Team mode (answer options split across teammates, forcing coordination) and Individuals mode (solo racing). This is the closest thing in this research set to "join by code, compete" — though synchronous/classroom-oriented, not an asynchronous 1v1 duel.
**Pricing:** Free tier with caps + ads. Quizlet Plus ~$35.99/yr or $7.99/mo. Plus Unlimited ~$44.99/yr.
**Sources:** [Quizlet engineering blog on Learn](https://medium.com/tech-quizlet/spaced-repetition-for-all-cognitive-science-meets-big-data-in-a-procrastinating-world-59e4d2c8ede1) · [Quizlet Live](https://quizlet.com/features/live)

### 3. RemNote — closest overall competitor

**What it is:** All-in-one outlining notes app with flashcards embedded **inline inside notes**, retaining full document context — the most direct combined notes+SRS product researched.
**Algorithm:** User-selectable **SM-2 or FSRS**. Cards come due at an estimated "10% chance you've forgotten" (~90% target retrievability).
**Notes+SRS combined:** **Yes** — this is RemNote's core pitch.
**AI features (extensive):** **"Any Source to Cards"** — converts PDFs, PowerPoint slides, YouTube videos, and raw text into flashcards/quizzes/summaries. **AI Tutor Chat** reads the user's own notes/PDFs, answers questions, and generates flashcards/study guides.
**Confidence/misconception tracking:** Post-answer 4-point scale (Forgot / Partially recalled / Recalled with effort / Easily recalled) — same category as Anki's buttons, **not** a pre-answer confidence rating. No calibration curve found.
**Exam-date targeting:** **Exam Scheduler** — set an exam date, it paces new-card introduction so everything is covered before the date, weights priority by mastery + days remaining, and forces a **Final Review Period** (every card shown once right before the exam) to push retrievability up. Supports multiple simultaneous exam dates. This is conceptually close to our exam mode, but works by pacing/forcing a final pass rather than displaying a computed recall-probability number.
**Collaboration:** Workspace/document sharing (Notion-like) at paid tiers; **no dueling or quiz-vs-friend feature found**.
**Analytics:** Flashcard Home stats, per-card Mastery Levels (New → Acquiring → Growing), Pro-gated Knowledge Graph. A retention heatmap is a community _feature request_, not yet native. No calibration curve.
**Pricing:** Free (core) / Pro $8/mo / Pro+AI $18/mo (credit-metered AI usage).
**Sources:** [RemNote spaced repetition](https://www.remnote.com/feature/spaced-repetition) · [Any Source to Cards](https://www.remnote.com/any_source_to_cards) · [Exam Scheduler](https://help.remnote.com/en/articles/9102040-understanding-the-exam-scheduler)

### 4. Obsidian + "Spaced Repetition" community plugin

**What it is:** General-purpose local-first Markdown PKM app; the leading third-party plugin (st3v3nmw, ~2.3k GitHub stars) bolts SRS onto it.
**Algorithm:** Plugin supports both **FSRS and SM-2**, user-selectable.
**Notes+SRS combined:** Yes — cards written inline via text patterns (`Question::Answer`, cloze via highlight/bold), conceptually similar to RemNote but as an add-on to a general tool, not a purpose-built product.
**AI features:** None in the mainstream plugin (a separate, much less-adopted plugin — SRAI — adds OpenAI-based generation).
**Confidence/misconception tracking:** None.
**Exam-date targeting:** Not found.
**Collaboration:** None — single-user local plugin.
**Pricing:** Plugin free/open-source; Obsidian itself free for personal use.
**Sources:** [Plugin README](https://github.com/st3v3nmw/obsidian-spaced-repetition/blob/main/README.md)

### 5. SuperMemo (SM-18 / SM-19)

**What it is:** The original spaced-repetition software, built around "incremental reading" (import and annotate large bodies of text, extract fragments into flashcards over time) — intellectual ancestor of the whole category.
**Algorithm:** **SM-18** (2019) in SuperMemo 18; **SM-19** (2024) in newer desktop versions. SuperMemo 20 reportedly ships five competing algorithms plus PDF/YouTube import and "AI explanations" (lightly sourced, unverified).
**Notes+SRS combined:** Yes, via incremental reading — a different paradigm from RemNote's inline-flashcard model.
**AI features:** Unverified claim of "AI explanations" in SuperMemo 20 — needs direct confirmation before citing.
**Confidence/misconception tracking:** 0–5 post-answer grade (finer-grained than Anki's 4 buttons, but still post-answer). **Richest retention analytics of any product researched**: a tunable **Forgetting Index**, a Grade-vs-Forgetting-Index regression graph, and whole-collection retention estimates (e.g. "91.86% of material recallable at any time") — but this is a collection-wide statistic, not a per-item calibration curve.
**Exam-date targeting:** Not found.
**Collaboration:** None found (institutional multi-seat licensing exists, but that's not collaboration).
**Pricing:** SuperMemo.com language courses ~$9.90/mo subscription; SuperMemo 19/20 for Windows is a one-time perpetual-license purchase (exact current price unverified).
**Sources:** [Algorithm SM-18](https://supermemo.guru/wiki/Algorithm_SM-18) · [Forgetting Index](https://supermemo.guru/wiki/Forgetting_index_in_SuperMemo)

### 6. Mochi Cards

**What it is:** Markdown-based, offline-first note+flashcard app, differentiated mainly by clean UI versus Anki.
**Algorithm:** Proprietary default algorithm (undocumented); **FSRS available as a beta option** (exposes max interval and target retention settings).
**Notes+SRS combined:** Yes — Markdown notes convert to cards with one click.
**AI features:** None found — card creation is fully manual.
**Confidence/misconception tracking:** Only **2 buttons** — Forgot/Remembered — coarser than Anki, and reviewers note this is actually a weaker fit for FSRS, which is designed around more granular grades.
**Exam-date targeting:** Not found.
**Collaboration:** One-way deck publishing + file export/import; no real-time collab, no dueling. Shared-deck community is much smaller than Anki's.
**Pricing:** Free tier capped at 3 decks; Pro $5/mo or $40/yr for sync + mobile.
**Sources:** [Mochi reviewing docs](https://mochi.cards/docs/reviewing) · [Mochi vs Anki comparison](https://study-genius-ai.hatolabs.com/blog/mochi-vs-anki-2026)

### 7. Traverse

**What it is:** Mind mapping + connected notes + spaced-repetition flashcards, marketed toward deep understanding (e.g. medical students) rather than pure memorization.
**Algorithm:** **Unverified** — marketing states scheduling is "similar to Anki's but customizable," and Anki decks (with scheduling data) can be imported, implying an SM-2-like core, but no source names it explicitly as SM-2 or FSRS.
**Notes+SRS combined:** Yes — this is Traverse's core pitch.
**AI features:** **Not found / not verified** — worth a direct changelog check before citing either way.
**Confidence/misconception tracking:** Not found. Dashboard tracks streaks, per-card mastery, "difficult cards," study-time estimates — no calibration curve.
**Exam-date targeting:** **Not clearly verified** despite exam-prep marketing language ("meeting targets at an optimal time") — no documented feature matching RemNote's Exam Scheduler was found.
**Collaboration:** Mind-map link sharing; course-creator/publishing features (more monetization-oriented than social study); no dueling found.
**Pricing:** Free tier; Member plan from $15/month flat.
**Sources:** [Traverse alternatives comparison](https://traverse.link/alternative-study-apps/spaced-repetition-online)

### 8. NotebookLM (Google) — AI-notes comparison point, not an SRS tool

**What it is:** Source-grounded AI research/study assistant on Gemini, using RAG so every answer cites back to the user's own uploaded sources — explicitly designed to minimize hallucination.
**Algorithm:** **None.** Critical finding: added **Flashcards and Quizzes** (web Sept 2025, mobile Nov 2025, customizable difficulty/topic/count) generated from sources, with an "Explain" button citing sources — but **no due-date scheduler, no review queue, no tracking of repeatedly-missed cards, no forgetting-curve timing at all.** Independent reviews explicitly recommend exporting cards into a real SRS tool for actual retention.
**Notes+SRS combined:** N/A.
**AI features:** Extensive — study guides, summaries, flashcards, quizzes, mind maps, audio/video "Overviews," a "Learning Guide" conversational tutor mode, agentic Deep Research (Nov 2025). Accepts PDFs, slides, audio, video, web links as sources.
**Citation grounding (directly relevant to our teaching-assistant feature):** Inline citations on essentially every chat claim; clicking jumps to the exact source passage. **Limitation:** citations are not available inside generated infographics, slide decks, or audio/video overviews — only in chat/Q&A and flashcard "Explain" outputs.
**Confidence/misconception tracking:** N/A (no review-tracking system to build it on).
**Collaboration:** Notebook sharing with Viewer/Editor roles, plus public link sharing (query-only for viewers), even on free tier.
**Pricing:** Free (100 notebooks, 50 sources, 50 chats/day) / Plus $4.99/mo / Pro $19.99/mo (student discount $9.99/mo) / Ultra $99.99–$199.99/mo. Not purchasable standalone — bundled with a Google AI plan.
**Sources:** [Flashcards/Quizzes launch](https://workspaceupdates.googleblog.com/2025/09/flashcards-quizzes-reports-notebook-lm-google-education.html) · [NotebookLM lacks spaced repetition — analysis](https://flashcards-open-source-app.com/blog/notebooklm-flashcards-to-spaced-repetition/)

### 9. Notion AI — general AI-notes comparison point

**What it is:** AI layered onto Notion's collaborative workspace/wiki — not a study tool.
**Algorithm:** N/A.
**Notes+SRS combined:** **No — confirmed gap.** Multiple sources explicitly state Notion AI has no flashcard generation, no quiz mode, no spaced-repetition scheduler at all. The only workaround is manually building a toggle-list of Q&A pairs.
**AI features:** **Notion Q&A / "Ask Notion"** — workspace-wide Q&A with citations back to source pages, plus AI Connectors (Gmail, Slack, Drive, Linear, Calendar, GitHub, Jira). Notion 3.0 (Sept 2025) added autonomous Personal Agents and shareable Custom Agents (GA May 2026).
**Confidence/misconception tracking:** N/A.
**Exam-date targeting:** N/A.
**Collaboration:** Notion's base product is a real-time collaborative workspace (multiplayer docs, comments, permissions) — this is the product's core strength, separate from the AI layer. No study/quiz features at all.
**Pricing:** Free / Plus $10/seat/mo / Business $20/seat/mo — **full AI now requires Business** (the standalone $10/mo AI add-on was discontinued May 2025). Custom Agents run on metered credits ($10 per 1,000 credits).
**Sources:** [Notion AI features timeline](https://fazm.ai/t/notion-ai-features-2025-2026) · [Notion pricing 2026](https://www.notis.ai/blog/notion-ai-pricing-2026-what-you-actually-pay-per-seat/)

### 10. Duolingo — reference point only, not a direct competitor

**What it is:** Consumer language-learning app, included purely as the best-known example of spaced repetition + social/gamification design executed at massive scale.
**Algorithm:** **Half-Life Regression (HLR)** — a proprietary ML model (2016 ACL paper) distinct from SM-2/FSRS. Estimates a continuous "half-life" per word/skill from learned weights over difficulty and user history; recall probability decays exponentially from that half-life. Runs inside "Birdbrain," Duolingo's broader real-time personalization system (also GPT-4-based roleplay, bandit algorithms for exercise selection) — reportedly personalizing 1.25 billion exercises/day.
**Confidence/misconception tracking:** Not found as a distinct feature.
**Exam-date targeting:** N/A — Duolingo is a continuous-habit product.
**Collaboration (the reason it's worth citing):** **Leagues** — weekly-reset leaderboard cohorts of 30 (Bronze through Diamond, bottom 5 demoted weekly). **Friend Streak** — up to 5 mutual streaks; users with a friend streak are **22% more likely** to complete a daily lesson, and friended users are **5.6x more likely** to finish a course. Leagues alone reportedly lifted lesson completion by 25%.
**Sources:** [Original HLR paper](https://research.duolingo.com/papers/settles.acl16.pdf) · [Duolingo friend streak blog](https://blog.duolingo.com/friend-streak/)

---

## Summary table

| Product                    | Notes+SRS combined?       | Algorithm                                       | AI item generation?                               | Confidence/calibration tracking?                 | Exam-date targeting?                     | Collaborative features?                        |
| -------------------------- | ------------------------- | ----------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- | ---------------------------------------------- |
| **Anki**                   | No                        | SM-2 default, FSRS opt-in                       | No                                                | No — post-answer only                            | Not found                                | Shared Decks (one-way); 3rd-party live collab  |
| **Quizlet**                | No                        | Proprietary session-adaptive ML, not SM-2/FSRS  | Yes (Magic Notes); tutor discontinued             | Not found                                        | Not found                                | Quizlet Live (join-by-code classroom game)     |
| **RemNote**                | **Yes**                   | SM-2 or FSRS, selectable                        | Yes — extensive (PDF/PPT/YouTube→cards, AI tutor) | No — post-answer 4-point scale                   | **Yes (closest match)** — Exam Scheduler | Workspace sharing; no dueling                  |
| **Obsidian + SR plugin**   | Yes                       | SM-2 or FSRS, selectable                        | No (mainstream plugin)                            | No                                               | Not found                                | None (single-user)                             |
| **SuperMemo**              | Yes (incremental reading) | SM-18 / SM-19                                   | Unverified                                        | No — but richest collection-wide retention stats | Not found                                | None                                           |
| **Mochi Cards**            | Yes                       | Proprietary + FSRS beta                         | No                                                | No — 2-button only                               | Not found                                | One-way publish; no dueling                    |
| **Traverse**               | Yes                       | Unverified ("Anki-like")                        | Not verified                                      | Not found                                        | Not verified                             | Mind-map sharing; no dueling                   |
| **NotebookLM**             | N/A                       | **None** — flashcards have no scheduling at all | Yes — extensive                                   | N/A                                              | N/A                                      | Notebook sharing + public links                |
| **Notion AI**              | **No — confirmed gap**    | N/A                                             | Partial — Q&A only, no flashcards/quiz            | N/A                                              | N/A                                      | Core Notion is collaborative (not AI-specific) |
| **Duolingo** _(reference)_ | N/A                       | Half-Life Regression (proprietary ML)           | Yes (Birdbrain)                                   | Not found                                        | N/A                                      | Leagues, Friend Streaks — strong social design |

---

## What this means for our positioning

1. **Confidence-before-answer + misconception detection is a genuinely open gap.** Every product with any self-report mechanism does it post-answer (Again/Hard/Good/Easy-style). Nobody crosses a pre-answer belief against objective correctness as a distinct product signal.
2. **RemNote is the closest overall competitor** — it already combines notes, inline flashcards, FSRS, AI-generated cards from PDFs/PPTs, and an exam scheduler. Our exam mode needs to be positioned specifically against RemNote's Exam Scheduler: we compute and can display an actual predicted-recall-probability number for the exam date itself, rather than pacing new cards and forcing a final pass.
3. **NotebookLM validates the "grounded, cited AI" approach** but proves that AI-generated flashcards without a real scheduler behind them (no due dates, no forgetting-curve timing) is a known-incomplete pattern — independent reviewers already tell users to export NotebookLM's flashcards into Anki or RemNote. This is useful supporting evidence that scheduling intelligence, not just AI generation, is the differentiator that matters.
4. **Quizlet Live and Duolingo's Leagues/Friend Streaks** are the strongest existing precedents for the social layer — worth studying their mechanics (join-by-code, small cohort sizes, coordination-forcing team splits) as design references for quiz duels, separate from their scheduling approach.
5. **Calibration curves and per-item retention forecasting genuinely don't exist elsewhere** as dashboard features — SuperMemo's Forgetting Index is the nearest analog and it's collection-wide, not per-item or confidence-based.

**Caveat for the report:** Traverse's algorithm/exam-date claims and SuperMemo's "AI explanations" claim are flagged above as unverified — re-check `traverse.link`'s changelog and `supermemo.store` directly before quoting specifics from those two in a formal writeup.
