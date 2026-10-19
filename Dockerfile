# Society Plot Manager — one image, two processes.
#
# Derived from ARCHITECTURE.md §14.2 ("Build outputs" and "web and worker are the
# same image with different entrypoints"), §3.1 (Node.js 24 LTS, PostgreSQL 17)
# and §3.6 ("use npm ci in CI and Docker").
#
#   docker build -t spm:local .
#   web:    node .next/standalone/server.js
#   worker: node dist/worker/main.js
#   migrate: npx prisma migrate deploy   (Prisma CLI is a production dependency)

# --- Base ------------------------------------------------------------------
FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma's query engine needs OpenSSL at runtime (Prisma 6 on Debian slim).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- Dependencies (all, for the build) -------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- Build (Next.js standalone + worker bundle) ----------------------------
FROM base AS build
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
    && npm run build \
    && npm run build:worker

# --- Production dependencies (includes the Prisma CLI, §14.2) --------------
FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Runtime ---------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Writable upload directory (ARCHITECTURE.md §14.1: /srv/spm/files).
RUN mkdir -p /srv/spm/files && chown -R node:node /srv/spm/files /app

USER node
EXPOSE 3000
CMD ["node", ".next/standalone/server.js"]
