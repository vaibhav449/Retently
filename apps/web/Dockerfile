# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/web/Dockerfile -t web .

ARG NODE_VERSION=24.21.0

# ---- base: Node + pnpm, shared by every build stage ----
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION=10.19.0
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm install --global --no-update-notifier pnpm@${PNPM_VERSION}
WORKDIR /app

# ---- pruner: cut the monorepo down to this app and its workspace packages ----
FROM base AS pruner
ARG TURBO_VERSION=2.11.9
RUN npm install --global --no-update-notifier turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune @repo/web --docker

# ---- deps: install all dependencies. Cached until a package.json or the lockfile changes ----
FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store

# ---- builder: `next build` writes a self-contained server to .next/standalone ----
FROM deps AS builder
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@repo/web

# ---- runner: standalone output only. It already contains the node_modules it needs ----
FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# Owned by `node` because Next.js writes its runtime cache under .next/
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1
CMD ["node", "apps/web/server.js"]
