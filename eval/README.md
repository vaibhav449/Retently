# eval

Evaluation of the revision engine (`docs/revision-engine/09-evaluation.md`). Owner: Vaibhav.

| Folder                                | What                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `synth/`                              | Synthetic students and `npm run db:seed` (09 §5)                       |
| `replay/`, `metrics/`, `experiments/` | Not started: the replay harness, metrics and E1–E5 are a later feature |

`eval/` depends on `@repo/revision`, `@repo/scheduler`, `@repo/db` and `@repo/contracts` through their public
exports only. Nothing in `packages/` depends on `eval/`.

## `npm run db:seed`

```sh
npm run db:seed                 # 20 students, 60 days, up to now (~3 min on a laptop)
npm run db:seed -- --quick      # 3 students, 14 days (~15 s): what tests and CI use
npm run db:seed -- --reset      # only remove the synthetic cohort
npm run db:seed -- --help       # every option: --students, --days, --seed, --end, --truth, --no-demo, --allow-remote
```

It prints the target database first and refuses (exit 2, nothing written) any host other than `localhost`,
`127.0.0.1` or `::1` unless `--allow-remote` is passed. Every run deletes the previous synthetic cohort and
builds a new one, so it never duplicates and never touches anyone else.

**Demo sign-in** (dev and staging only): `demo@synthetic.invalid` / `synthetic-demo`. It opens `/review` and
`/exams` as a student with weeks of history and an exam. The credential is refused when `NODE_ENV=production`:
seed with `--no-demo` there.

### Synthetic users are marked

Every synthetic user has an email on **`synthetic.invalid`** (RFC 2606 reserves `.invalid`, so no real inbox
has it) and an id `synth_<seed tag>_<nn>`. The one shared filter lives in `packages/db`:

```ts
import { isSyntheticEmail, realUsers, syntheticUsers } from "@repo/db";

db.reviewLog.findMany({ where: { user: realUsers() } }); // analytics, evaluation, cohort exports: the default
db.user.deleteMany({ where: syntheticUsers() }); // what --reset does
```

Analytics, evaluation and cohort exports must use `realUsers()` unless they ask for synthetic data on purpose.

## What a run does

For each simulated local day, for each student (a few students at once; they share nothing):

1. The day's new questions appear at 08:00 local, as rows in the normal tables (document, source, chunks,
   items), with `created_at` then. The student studies them then (SS-3).
2. On the exam's set-up day, `createExam()` at 08:30, so the API's own checks apply.
3. If the student is active that day, `getOrCreateSession()` builds today's plan at the simulated time. Then
   `nextInSession()` takes the entries in the engine's order. Each answer is drawn from the hidden model and
   recorded with `recordReview()` (`context = solo`). The injected clock moves by the latency, then by the
   reveal time (`DEFAULT_QUEUE.feedbackSec`).

Nothing about grading, scheduling, ranking or mapping is worked out in `eval/`. No LLM is called, and the bank is
templates over 152 hand-written facts in 8 notes (`synth/bank.ts`).

The simulated days are the `--days` local days **before** the end's local date. On the end day only that
morning's questions appear (SS-7), so whoever signs in finds a real session and live exam countdowns.

## The student model

Every constant is in `synth/config.ts`, with its source. The spec is 09 §5.2; where it is silent, the
generator's own choices are:

| #    | Choice                                                                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SS-1 | Each student owns their own copy of the 8 notes (access is owner-only). Every id is SHA-256 of (seed, student, kind, index), as a v4-shaped uuid; review ids are `uuidv7(simulated time, seeded bytes)`.                                                                                               |
| SS-2 | Profiles rotate over a fixed list of 10 (`config.profiles`), so even 3 students cover over/under-confidence, a non-FSRS truth and an exam: over 10, 5 over / 2 calibrated / 3 under, 2 `expHalfLife`, 5 exams (1 at 0.95). β is drawn per group; the 5:2:3 mix averages 0.42, close to the spec's 0.4. |
| SS-3 | The hidden memory starts when a question appears (a first study graded Good), so a first exposure reflects having just written the note, not a cold guess.                                                                                                                                             |
| SS-4 | Users join at 07:00 of day 0; questions appear at 08:00, an exam is set up at 08:30; a student's session starts around their own hour (N(19, 2.5²)), ±1 h a day, within 09:00–22:30.                                                                                                                   |
| SS-5 | `expHalfLife`: h starts at 6 days × exp(−0.3 δ), ×(1 + a·0.8) per success (the spec's ×1.8), ×0.5 per failure, never below 0.25 days; a corrected misconception restarts at 0.6 × the start.                                                                                                           |
| SS-6 | Confidence cuts at u > 2.2 (Sure, ≈ "90 % sure") and u > 0.4 (Think so, ≈ "60 %"), not the spec's 1.2 / −0.4: at the engine's 0.9 target, recall at a review is mostly 0.85–0.95, where the spec's cut makes ~95 % of answers Sure whatever the bias, and then no bias can be measured (V4).           |
| SS-7 | The bank's last 6 questions appear on the end day itself (at 08:00, or at the end if earlier), so no student opens `/review` to an empty day.                                                                                                                                                          |
| SS-8 | The memory update uses whether the student really recalled: a lucky guess (the 0.25 floor) is not a success. R_true is taken when the item is shown.                                                                                                                                                   |
| SS-9 | `review_sessions.id` and `exams.id` are minted by the engine (Prisma's `uuid()`) and are not seeded. V7 compares everything else, with exam ids relabelled by (user, `created_at`) wherever they appear.                                                                                               |

The item type mix (`config.content.typeMix`) is MCQ-only. Flip it when the review screen serves cloze and short
answer, together with `DEFAULT_QUEUE.servedTypes` and the answer model in `synth/answer.ts`. The bank already
has cloze and short-answer forms of every fact.

## The truth sidecar

`eval/out/truth-<seed>.jsonl` (gitignored; `--truth <path>` to move it). It holds JSON lines with sorted keys
and no wall-clock time, so the same seed and end give the same file:

- one `run` line: seed, end, days, students, the config hash;
- per student, a `student` line: truth family, bias group and β, the FSRS-6 parameters `w`, ability, speed,
  adherence, budget, the exam;
- after it, that student's `review` lines in recording order: `review_id` (= `review_log.id`), `r_true`,
  `p_correct` (what an oracle predicts, V1), `misconceived`, `recalled`, `first_exposure`.

It never contains anything about real users.

## Tests

- `npm test --workspace @repo/eval`: the RNG, bank, students, truth models, answer model and safety checks.
- `npm run test:integration --workspace @repo/eval`: seeds the quick cohort twice into a throwaway database and
  checks the following:
  - every answer went through `recordReview()`, every session through the session builder, and `llm_usage`
    is empty;
  - V6 (`checkCardState`, I2 + I4);
  - V7 (identical rows and sidecar);
  - the statistical shape and honest timestamps;
  - the exam forecast and countdowns;
  - the safety refusals, and that `--reset` removes only synthetic rows.
- `apps/web/e2e/synthetic.e2e.mts`: signs in as the demo student. `/review` serves a question and `/exams`
  shows a forecast. CI runs `npm run db:seed -- --quick` before the E2E job.
