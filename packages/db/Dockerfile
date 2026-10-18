# syntax=docker/dockerfile:1
# One-off job that applies database migrations, then exits.
# Build from the repo root:  docker build -f packages/db/Dockerfile -t migrate .

ARG NODE_VERSION=24.21.0

# ---- base: Node + pnpm, shared by every build stage ----
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION=10.19.0
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    TURBO_TELEMETRY_DISABLED=1
RUN npm install --global --no-update-notifier pnpm@${PNPM_VERSION}
WORKDIR /app

# ---- pruner: cut the monorepo down to the db package ----
FROM base AS pruner
ARG TURBO_VERSION=2.11.9
RUN npm install --global --no-update-notifier turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune @repo/db --docker

# ---- deps: install all dependencies. Cached until a package.json or the lockfile changes ----
FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store

# ---- builder: bundle the migration runner into packages/db/dist ----
FROM deps AS builder
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@repo/db

# ---- prod-deps: only the runtime dependencies of the db package ----
FROM base AS prod-deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter=@repo/db --store-dir=/pnpm/store

# ---- runner: migration runner + SQL files ----
FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle
USER node
CMD ["node", "--enable-source-maps", "packages/db/dist/migrate.js"]
