# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/web/Dockerfile -t web .

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-alpine AS base
ARG NPM_VERSION=11.17.0
ENV TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm install --global --no-update-notifier npm@${NPM_VERSION}
WORKDIR /app

FROM base AS pruner
ARG TURBO_VERSION=2.11.9
RUN npm install --global --no-update-notifier turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune @repo/web --docker

# Include sources before installation so workspace generation scripts can run.
FROM base AS deps
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/full/ .
RUN --mount=type=cache,id=npm-cache,target=/root/.npm npm ci

FROM deps AS builder
RUN npm exec -- turbo run build --filter=@repo/web

# Runtime image
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
