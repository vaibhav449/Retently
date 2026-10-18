# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/worker/Dockerfile -t worker .

ARG NODE_VERSION=24.21.0

# ---- base: Node + pnpm, shared by every build stage ----
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION=10.19.0
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    TURBO_TELEMETRY_DISABLED=1
RUN npm install --global --no-update-notifier pnpm@${PNPM_VERSION}
WORKDIR /app

# ---- pruner: cut the monorepo down to this app and its workspace packages ----
FROM base AS pruner
ARG TURBO_VERSION=2.11.9
RUN npm install --global --no-update-notifier turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune @repo/worker --docker

# ---- deps: install all dependencies. Cached until a package.json or the lockfile changes ----
FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store

# ---- builder: bundle TypeScript into apps/worker/dist ----
FROM deps AS builder
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@repo/worker

# ---- prod-deps: only this app's runtime dependencies (no dev tools, no workspace packages) ----
FROM base AS prod-deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter=@repo/worker --store-dir=/pnpm/store

# ---- runner: the image that ships. No pnpm, no source, no compilers ----
FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
USER node
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4001/health > /dev/null || exit 1
CMD ["node", "--enable-source-maps", "apps/worker/dist/index.js"]
