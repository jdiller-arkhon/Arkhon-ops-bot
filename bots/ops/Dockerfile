# Build context: repository root.  docker build -f bots/ops/Dockerfile .
FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---- build: install everything, compile TypeScript
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY bots/ops/package.json bots/ops/
COPY prisma prisma
COPY scripts scripts
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY bots/ops bots/ops
RUN pnpm exec tsc -b bots/ops

# ---- runtime: production dependencies + compiled output
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY bots/ops/package.json bots/ops/
COPY prisma prisma
COPY scripts scripts
RUN pnpm install --frozen-lockfile --prod --filter @arkhon/ops-bot... --filter arkhon-bots \
  && pnpm store prune
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/bots/ops/dist bots/ops/dist
COPY bots/ops/assets bots/ops/assets
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WEBHOOK_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# With DATABASE_URL, Prisma migrations run first; on Cloudflare (D1_BRIDGE_URL) the bot applies
# prisma/d1-migrations itself. exec replaces the shell so node is PID 1 and receives SIGTERM.
CMD ["sh", "-c", "set -e; if [ -n \"$DATABASE_URL\" ]; then node scripts/prisma.mjs migrate deploy; fi; exec node bots/ops/dist/index.js"]
