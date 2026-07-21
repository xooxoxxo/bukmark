FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/cli/package.json apps/cli/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
EXPOSE 3000
CMD ["pnpm", "--filter", "@bookmarkt/server", "exec", "tsx", "src/main.ts"]
