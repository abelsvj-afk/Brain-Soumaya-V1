# syntax=docker/dockerfile:1

# ---- builder: install deps, build web, bake embedding model ----
FROM node:22-bookworm AS builder
WORKDIR /app

# Native toolchain for better-sqlite3 (used if no prebuilt binary is available)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install all workspaces (manifests first for better layer caching)
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

# Build the static web app and download the embedding model into the image
COPY . .
RUN npm run build -w @brain/web
ENV EMBED_CACHE_DIR=/app/.model-cache
RUN npx tsx packages/server/src/embeddings/warm.ts

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIR=/app/packages/web/dist \
    EMBED_CACHE_DIR=/app/.model-cache \
    DB_PATH=/data/brain.db

# Bring over deps (with compiled better-sqlite3), source, built web, model cache
COPY --from=builder /app /app

# SQLite volume mount point (see fly.toml [[mounts]])
RUN mkdir -p /data
EXPOSE 8080

# Server runs TypeScript directly via tsx and serves the web app from WEB_DIR
CMD ["npx", "tsx", "packages/server/src/index.ts"]
