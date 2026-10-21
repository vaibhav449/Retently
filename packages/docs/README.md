# Project documentation

Implementation status as of 2026-10-18. Use the [root README](../../README.md) for setup and commands, and this page to distinguish the current code from the product roadmap.

## Current foundation

The repository is one Git repository containing three applications and shared packages. npm workspaces are declared in the root `package.json` as `apps/*` and `packages/*`. Each package has its own manifest, and local dependencies such as `@repo/contracts` use `"*"` so npm links the workspace package. External dependency versions are declared in the package manifests and resolved in the root `package-lock.json`.

The repo pins npm 11.17.0 and Node 24.21.0 (in `.nvmrc`). Turborepo coordinates development, builds, linting, typechecking, and tests; it also generates the Prisma client before dependent builds and typechecks.

| Path                             | Implemented today                                                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                       | Next.js 16, React 19, Tailwind 4, a placeholder home page, and `/api/health`                                                                                                                              |
| `apps/realtime`                  | Node HTTP server, `/health`, and a validated WebSocket echo endpoint at `/events`; connection heartbeat and shutdown handling                                                                             |
| `apps/worker`                    | RabbitMQ connection with startup retries, `/health`, and shutdown handling                                                                                                                                |
| `packages/contracts`             | Zod schemas and TypeScript types for health responses and WebSocket envelopes; validation tests                                                                                                           |
| `packages/db`                    | Prisma ORM 7.10.1, PostgreSQL adapter, `createDb(url)` with `close()`, client generation, and SQL migrations                                                                                              |
| `packages/eslint-config`         | Shared ESLint presets                                                                                                                                                                                     |
| `packages/revision`              | `mapGrade`: confidence × correctness × speed → FSRS grade (mapping `spec-v1`), with a test for every row of the grading table                                                                             |
| `packages/scheduler`             | Pure `Scheduler` interface and types, `placeholder-v0` (every item due one day after its review, R = 0.9^t), a version registry, and lint rules and tests that keep it free of clocks, randomness and I/O |
| `packages/typescript-config`     | Shared strict TypeScript presets for Node and Next.js                                                                                                                                                     |
| `.github/workflows` and `deploy` | CI, container builds, and VM deployment configuration; configuration alone does not establish that a deployment is running                                                                                |

The worker does not consume jobs yet. The web app does not connect to the realtime service or database yet. Authentication, application tables, uploads, AI processing, collaboration, revision scheduling, and duels remain planned. `ingest`, `llm`, and the evaluation harness are also planned packages. `scheduler` has only the placeholder so far (FSRS and SM-2 are planned), and `revision` only grade mapping (`recordReview()` is planned).

## Database workflow

- Schema: `packages/db/prisma/schema.prisma`. There are no application models yet.
- SQL migrations: `packages/db/prisma/migrations/`. The initial migration enables pgvector with `CREATE EXTENSION IF NOT EXISTS vector`.
- Configuration: `packages/db/prisma.config.ts` loads the root `.env` when present and respects environment variables supplied by CI or deployment.
- Generated client: `packages/db/src/generated/prisma/`, excluded from Git and generated automatically by `npm install` or `npm ci`.
- `createDb(url)` returns `{ db, close }`; `db` is a Prisma client, and `close()` disconnects it.

| Command, from the repository root                | Purpose                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `npm install`                                    | Install the npm workspace dependencies and generate the client    |
| `npm ci`                                         | Install from the committed lockfile and generate the client       |
| `npm run infra:up`                               | Start local PostgreSQL and RabbitMQ                               |
| `npm run db:generate`                            | Regenerate Prisma Client without connecting to a database         |
| `npm run db:migrate`                             | Apply committed migrations in development, CI, or deployment      |
| `npm run db:migrate:dev -- --name <change>`      | Create and apply a development migration after editing the schema |
| `npm run db:studio`                              | Open Prisma Studio                                                |
| `npm run dev`                                    | Start all three app development processes                         |
| `npm run check`                                  | Run lint, typecheck, tests, and the formatting check              |
| `npm run build`                                  | Build the apps and generate the database client                   |
| `npm run <script> --workspace @repo/web`         | Run one package's script                                          |
| `npm install <dependency> --workspace @repo/web` | Add a dependency to one package                                   |

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
