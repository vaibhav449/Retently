# Study Workspace

Monorepo for the AI-native collaborative study workspace: a Next.js web app, a realtime WebSocket server, a background worker, and the packages they share.

## Requirements

- Node 24 (version in `.nvmrc`)
- npm 11 (the repo pins npm 11.17.0)
- Docker Desktop, for Postgres and RabbitMQ (on Windows it needs WSL 2)

## Getting started

```bash
npm install
cp .env.example .env
npm run infra:up      # Postgres (with pgvector) and RabbitMQ in Docker
npm run db:migrate
npm run dev           # web on :3000, realtime on :4000, worker
```

- RabbitMQ dashboard: http://localhost:15672 (user `app`, password `app`)
- If port 4000 is taken on your machine, add `PORT=4100` (or any free port) to `.env`.

## Workspace structure

The root `package.json` declares npm workspaces for `apps/*` and `packages/*`. Run installs from the repository root: npm installs dependencies and links local packages such as `@repo/contracts`. Each workspace has its own `package.json`; the root `package-lock.json` records resolved dependencies for the whole repo. Use `npm ci` for a clean install from that lockfile.

Turborepo coordinates the workspace scripts and caches eligible results. The applications are currently skeletons: the web app has a placeholder page, realtime echoes validated messages, and the worker connects to RabbitMQ without consuming jobs. Authentication, application tables, AI processing, collaboration, and study features are planned.

The [project documentation index](packages/docs/README.md) describes the current implementation and links to the build plan, task distribution, and product specifications.

## What's inside

| Path                         | What it is                                                     |
| ---------------------------- | -------------------------------------------------------------- |
| `apps/web`                   | Next.js 16 app (App Router, Tailwind 4)                        |
| `apps/realtime`              | HTTP + WebSocket server: `/health`, and `/events` for messages |
| `apps/worker`                | Background worker connected to RabbitMQ                        |
| `packages/contracts`         | Zod schemas shared by every app                                |
| `packages/db`                | Prisma client, schema, and SQL migrations                      |
| `packages/eslint-config`     | Shared ESLint rules                                            |
| `packages/typescript-config` | Shared `tsconfig` presets                                      |
| `deploy/`                    | Production Compose stack, Caddyfile, VM scripts                |
| `docker-compose.yml`         | Local Postgres and RabbitMQ for development                    |

## Commands

| Command                                   | What it does                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`                             | Run every app in watch mode                                                  |
| `npm run build`                           | Build everything                                                             |
| `npm run check`                           | Lint, typecheck, tests, and formatting; CI also builds and checks migrations |
| `npm run format`                          | Format every file with Prettier                                              |
| `npm run <script> --workspace @repo/web`  | Run a script in one package only                                             |
| `npm install <dep> --workspace @repo/web` | Add a dependency to one package                                              |
| `npm run infra:up` / `npm run infra:down` | Start or stop local Postgres and RabbitMQ                                    |

## Database

The database package uses Prisma ORM 7 with the PostgreSQL driver adapter. The schema lives in `packages/db/prisma/schema.prisma`, and committed SQL migrations live in `packages/db/prisma/migrations/`. The initial migration enables pgvector; there are no application models yet.

- `npm install` generates the Prisma client automatically.
- `npm run db:generate` regenerates it after schema changes, without connecting to a database.
- `npm run db:migrate:dev -- --name <change>` creates and applies a migration locally.
- `npm run db:migrate` applies committed migrations, including in CI and production.
- `npm run db:studio` opens Prisma Studio.

Database commands load the root `.env` when present; environment variables supplied by CI or Docker take precedence. Generated client files are ignored by Git.

The initial SQL uses `CREATE EXTENSION IF NOT EXISTS`, so it can also run against a database previously initialized by the old migration runner. No existing tables or data are dropped.

## Deployment

Pull requests run CI (`.github/workflows/ci.yml`). Every push to `main` runs `.github/workflows/deploy.yml`:

1. CI again
2. Build four images (`web`, `realtime`, `worker`, `migrate`) and push them to GitHub Container Registry
3. SSH into the VM and run `deploy/deploy.sh`: pull images, apply migrations, restart, wait for health checks

One-time setup:

1. On a fresh Ubuntu VM, run `deploy/setup-vm.sh` as root.
2. Create `/opt/study-workspace/.env` from `deploy/.env.example`.
3. In GitHub, go to **Settings → Secrets and variables → Actions** and add:
   - Variables: `VM_HOST`, `VM_USER` (`deploy`), `APP_DIR` (`/opt/study-workspace`)
   - Secrets: `VM_SSH_KEY` (private key of the deploy key pair), `VM_SSH_KNOWN_HOSTS` (output of `ssh-keyscan <vm-ip>`)
