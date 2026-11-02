# Project documentation

Implementation status as of 2026-10-22. Use the [root README](../../README.md) for setup and commands, and this page to distinguish the current code from the product roadmap.

## Current foundation

The repository is one Git repository containing three applications and shared packages. npm workspaces are declared in the root `package.json` as `apps/*` and `packages/*`. Each package has its own manifest, and local dependencies such as `@repo/contracts` use `"*"` so npm links the workspace package. External dependency versions are declared in the package manifests and resolved in the root `package-lock.json`.

The repo pins npm 11.17.0 and Node 24.21.0 (in `.nvmrc`). Turborepo coordinates development, builds, linting, typechecking, and tests; it also generates the Prisma client before dependent builds and typechecks.

| Path                             | Implemented today                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                       | Next.js 16, React 19, Tailwind 4. Email and password accounts (Better Auth, 18+ only), a signed-in home page, the review screen at `/review`, and the routes `/api/health`, `/api/realtime-token`, `GET /api/review/next` and `POST /api/review/answer`; Playwright end-to-end tests                                                                    |
| `apps/realtime`                  | Node HTTP server, `/health`, and a validated WebSocket echo endpoint at `/events` that requires a realtime token (401 without one); connection heartbeat and shutdown handling                                                                                                                                                                          |
| `apps/worker`                    | Consumes `ingest.requested` from RabbitMQ: retries through a waiting room, parks jobs that give up, tells the source's owner on the `events` exchange, and shuts down without dropping a job; question generation is a stub until `packages/ingest` lands                                                                                               |
| `packages/contracts`             | Zod schemas and TypeScript types for health responses, WebSocket envelopes, the realtime token, items, citations, the review API, and the RabbitMQ jobs and events; fixtures validated against them                                                                                                                                                     |
| `packages/db`                    | Prisma ORM 7.10.1, PostgreSQL adapter, `createDb(url)` with `close()`, client generation, SQL migrations, and `canAccessSource()` (owner-only until sharing)                                                                                                                                                                                            |
| `packages/eslint-config`         | Shared ESLint presets                                                                                                                                                                                                                                                                                                                                   |
| `packages/messaging`             | RabbitMQ in one place: `assertTopology()`, confirmed publishing of jobs and events, retry and park, and the consumer loop the worker runs; integration tests against a real broker                                                                                                                                                                      |
| `packages/realtime-token`        | Signs and verifies the short-lived token that lets a signed-in user open `/events` (HS256, a secret shared by web and realtime)                                                                                                                                                                                                                         |
| `packages/revision`              | `recordReview()`: grades an answer, maps confidence × correctness to a grade (`spec-v1`), and writes `review_log` and `card_state` in one transaction (advisory lock, idempotent replay, duplicate guard); presentation tokens and the review API logic; `rebuildCardState()` and the I2 consistency check; unit tests and PostgreSQL integration tests |
| `packages/scheduler`             | Pure `Scheduler` interface, a version registry and `replay()`: `fsrs6-v1` (active), `sm2-v1` (for evaluation), and `placeholder-v0` (Phase 1 cards until they are rebuilt); lint rules and tests keep it free of clocks, randomness and I/O                                                                                                             |
| `packages/typescript-config`     | Shared strict TypeScript presets for Node and Next.js                                                                                                                                                                                                                                                                                                   |
| `.github/workflows` and `deploy` | CI (checks, migrations, PostgreSQL and RabbitMQ integration tests, Playwright end-to-end tests), container builds, and VM deployment configuration; configuration alone does not establish that a deployment is running                                                                                                                                 |

The worker consumes ingest jobs, but nothing publishes them yet, and the web app does not open the `/events` socket yet. Notes can be listed, created, renamed and deleted, but nothing in the app creates questions yet: the editor, question generation and uploads are planned, and the tests seed their own questions. Collaboration, daily review sessions, exam mode, analytics, and duels remain planned. `ingest`, `llm`, and the evaluation harness are also planned packages.

## Database workflow

- Schema: `packages/db/prisma/schema.prisma`. It has the auth models (`User`, `Session`, `Account`, `Verification`), content (`Document`, `Source`, `Chunk`, `Item`), revision (`ReviewLog`, `CardState`, `ReviewSession`, `ReviewPending`, `RevisionSettings`), and `LlmUsage`.
- SQL migrations: `packages/db/prisma/migrations/`. The initial migration enables pgvector with `CREATE EXTENSION IF NOT EXISTS vector`.
- Configuration: `packages/db/prisma.config.ts` loads the root `.env` when present and respects environment variables supplied by CI or deployment.
- Generated client: `packages/db/src/generated/prisma/`, excluded from Git and generated automatically by `npm install` or `npm ci`.
- `createDb(url)` returns `{ db, close }`; `db` is a Prisma client, and `close()` disconnects it.

| Command, from the repository root                | Purpose                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `npm install`                                    | Install the npm workspace dependencies and generate the client                     |
| `npm ci`                                         | Install from the committed lockfile and generate the client                        |
| `npm run infra:up`                               | Start local PostgreSQL and RabbitMQ                                                |
| `npm run db:generate`                            | Regenerate Prisma Client without connecting to a database                          |
| `npm run db:migrate`                             | Apply committed migrations in development, CI, or deployment                       |
| `npm run db:migrate:dev -- --name <change>`      | Create and apply a development migration after editing the schema                  |
| `npm run db:studio`                              | Open Prisma Studio                                                                 |
| `npm run dev`                                    | Start all three app development processes                                          |
| `npm run check`                                  | Run lint, typecheck, tests, and the formatting check                               |
| `npm run test:integration`                       | Run the tests that need PostgreSQL; each run uses its own database                 |
| `npm run test:e2e`                               | Run the Playwright tests against the web dev server                                |
| `npm run engine:rebuild`                         | Replay every card's answers through the active scheduler and rewrite `card_state`  |
| `npm run engine:check`                           | Check that every `card_state` row equals the replay of its answers; exits 1 if not |
| `npm run build`                                  | Build the apps and generate the database client                                    |
| `npm run <script> --workspace @repo/web`         | Run one package's script                                                           |
| `npm install <dependency> --workspace @repo/web` | Add a dependency to one package                                                    |

No `db:seed` command is implemented yet. Seed users, notes, questions, and synthetic review histories belong to the roadmap.

## Reading order

| Document                                                  | Role                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Build plan](build-plan.md)                               | Active architecture and phased implementation plan; its target layout includes packages that do not exist yet |
| [Task distribution](task-distribution.md)                 | Team ownership and remaining implementation tasks                                                             |
| [MVP specification](mvp-spec-v0.2.md)                     | Product scope and revision-engine requirements; the build plan supersedes its older architecture and schedule |
| [Original product specification](study-workspace-spec.md) | Earlier product rationale and planning context                                                                |
| [Revision engine explained](revision-engine-explained.md) | Explanation of the planned scheduling and confidence logic                                                    |
| [Competitor analysis](competitor-analysis.md)             | Research context; competitor claims retain their original verification notes                                  |
