# syntax=docker/dockerfile:1
# bukmark server image: builds the web SPA, ships the monorepo run via tsx
# (the project never compiles — noEmit everywhere — so runtime executes TS directly).
# On start it applies DB migrations, then serves the API + apps/web/dist.

FROM node:26-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# .dockerignore strips node_modules/data/work/output/.git — COPY brings source only.
# corepack reads the root package.json "packageManager" field to pin the exact
# pnpm version, so the frozen install matches the committed lockfile.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bukmark/web build

FROM node:26-slim AS runtime
# Set by the release workflow from the git tag; "dev" for local builds.
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/xooxoxxo/bukmark" \
      org.opencontainers.image.title="bukmark" \
      org.opencontainers.image.description="Bookmarks you own. A self-hosted bookmark manager." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# pnpm uses relative symlinks inside node_modules/.pnpm, so copying the whole
# tree in one layer keeps them intact. The files stay owned by root and
# read-only to the app: it writes nothing under /app (tsx caches in /tmp).
COPY --from=build /app /app
# The unprivileged user the node image ships (uid 1000).
USER node
EXPOSE 3000
# The slim image has no curl; Node's own fetch asks /healthz. Lets Docker,
# Compose, Unraid and the like show whether bukmark is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["sh", "-c", "node_modules/.bin/tsx apps/server/src/db/migrate.ts && exec node_modules/.bin/tsx apps/server/src/main.ts"]
