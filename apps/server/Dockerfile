# syntax=docker/dockerfile:1
# bukmark server image: builds the web SPA, ships the monorepo run via tsx
# (the project never compiles — noEmit everywhere — so runtime executes TS directly).
# On start it applies DB migrations, then serves the API + apps/web/dist.

FROM node:22-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# .dockerignore strips node_modules/data/work/output/.git — COPY brings source only.
# corepack reads the root package.json "packageManager" field to pin the exact
# pnpm version, so the frozen install matches the committed lockfile.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bukmark/web build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# pnpm uses relative symlinks inside node_modules/.pnpm, so copying the whole
# tree in one layer keeps them intact.
COPY --from=build /app /app
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/tsx apps/server/src/db/migrate.ts && exec node_modules/.bin/tsx apps/server/src/main.ts"]
