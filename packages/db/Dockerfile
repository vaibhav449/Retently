# syntax=docker/dockerfile:1
# One-off job that applies Prisma migrations, then exits.
# Build from the repo root: docker build -f packages/db/Dockerfile -t migrate .

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-alpine AS base
ARG NPM_VERSION=11.17.0
ENV TURBO_TELEMETRY_DISABLED=1
RUN apk add --no-cache openssl
RUN npm install --global --no-update-notifier npm@${NPM_VERSION}
WORKDIR /app

FROM base AS pruner
ARG TURBO_VERSION=2.11.9
RUN npm install --global --no-update-notifier turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune @repo/db --docker

# The migration image needs the Prisma CLI, which is a development dependency.
FROM base AS deps
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/full/ .
RUN --mount=type=cache,id=npm-cache,target=/root/.npm npm ci

FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/db ./packages/db
USER node
CMD ["npm", "run", "migrate", "--workspace", "@repo/db"]
