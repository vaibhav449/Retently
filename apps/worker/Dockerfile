# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/worker/Dockerfile -t worker .

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-alpine AS base
ARG NPM_VERSION=11.17.0
ENV TURBO_TELEMETRY_DISABLED=1
RUN npm install --global --no-update-notifier npm@${NPM_VERSION}
WORKDIR /app

FROM base AS pruner
ARG TURBO_VERSION=2.11.9
RUN npm install --global --no-update-notifier turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune @repo/worker --docker

# Include sources before installation so workspace generation scripts can run.
FROM base AS deps
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/full/ .
RUN --mount=type=cache,id=npm-cache,target=/root/.npm npm ci

FROM deps AS builder
RUN npm exec -- turbo run build --filter=@repo/worker

# Install runtime dependencies for this app; local TypeScript packages are bundled.
FROM base AS prod-deps
COPY --from=pruner /app/out/json/ .
# Restrict membership so npm excludes the shared tooling packages' runtime dependencies.
RUN npm pkg set 'workspaces[0]=apps/worker' \
    && npm pkg delete 'workspaces[1]'
RUN --mount=type=cache,id=npm-cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --workspace @repo/worker

# Runtime image
FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/worker/ ./apps/worker/
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
USER node
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4001/health > /dev/null || exit 1
CMD ["node", "--enable-source-maps", "apps/worker/dist/index.js"]
