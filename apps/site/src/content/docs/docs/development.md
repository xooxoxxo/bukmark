---
title: Development
description: Set up a local development environment and understand the bukmark monorepo.
sidebar:
  order: 9
---

Run bukmark from a checkout with hot reload.

## Development commands

1. Start Postgres:

   ```bash
   docker compose up -d db
   ```

2. Start the API on :3000:

   ```bash
   cd apps/server && pnpm dev
   ```

3. Start the web app (Vite proxies `/api` to the API):

   ```bash
   cd apps/web && pnpm dev
   ```

4. Open the web app, enter a password (12+ characters) twice and click
   **Create password**.

Tests and type check:

```bash
pnpm test                        # full suite
pnpm typecheck
```

To reset the password, run
`pnpm --filter @bukmark/server auth:reset-owner` (add `--revoke-tokens` to
delete access tokens too).

After `pnpm --filter @bukmark/web build`, restart the server to serve the new
bundles.

## Monorepo layout

| Path | What it is |
| -- | -- |
| `apps/server` | Fastify + Drizzle (API backend) |
| `apps/web` | React 19 + Vite (web UI) |
| `apps/extension` | MV3, vanilla TypeScript (browser extension) |
| `apps/mcp` | MCP server (for any MCP-compatible client) |
| `apps/cli` | CLI tool for batch triage |
| `packages/shared` | Shared types and utilities |

## Preview images

Saving a link fetches its `og:image` on the server. The fetcher blocks private,
loopback, link-local (including `169.254.169.254`) and CGNAT addresses,
re-checks every redirect, and caps time and body size.
