# Study Workspace

Monorepo for the AI-native collaborative study workspace: a Next.js web app, a realtime WebSocket server, a background worker, and the packages they share.

## Requirements

- Node 24 (version in `.nvmrc`)
- pnpm 10: `npm install -g pnpm@10`
- Docker Desktop, for Postgres and RabbitMQ (on Windows it needs WSL 2)

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm infra:up      # Postgres (with pgvector) and RabbitMQ in Docker
pnpm db:migrate
pnpm dev           # web on :3000, realtime on :4000, worker
```

- RabbitMQ dashboard: http://localhost:15672 (user `app`, password `app`)
- If port 4000 is taken on your machine, add `PORT=4100` (or any free port) to `.env`.

## What's inside

| Path                         | What it is                                                     |
| ---------------------------- | -------------------------------------------------------------- |
| `apps/web`                   | Next.js 16 app (App Router, Tailwind 4)                        |
| `apps/realtime`              | HTTP + WebSocket server: `/health`, and `/events` for messages |
| `apps/worker`                | Background worker connected to RabbitMQ                        |
| `packages/contracts`         | Zod schemas shared by every app                                |
| `packages/db`                | Drizzle client, SQL migrations, migration runner               |
| `packages/eslint-config`     | Shared ESLint rules                                            |
| `packages/typescript-config` | Shared `tsconfig` presets                                      |
| `deploy/`                    | Production Compose stack, Caddyfile, VM scripts                |
| `docker-compose.yml`         | Local Postgres and RabbitMQ for development                    |

## Commands

| Command                             | What it does                                       |
| ----------------------------------- | -------------------------------------------------- |
| `pnpm dev`                          | Run every app in watch mode                        |
| `pnpm build`                        | Build everything                                   |
| `pnpm check`                        | Lint, typecheck, test and format check, same as CI |
| `pnpm format`                       | Format every file with Prettier                    |
| `pnpm --filter @repo/web <script>`  | Run a script in one package only                   |
| `pnpm --filter @repo/web add <dep>` | Add a dependency to one package                    |
| `pnpm infra:up` / `pnpm infra:down` | Start or stop local Postgres and RabbitMQ          |

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
