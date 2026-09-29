---
title: Development
description: Set up a local development environment and understand the bukmark monorepo.
sidebar:
  order: 9
---

Run bukmark from a checkout with hot reload. At the end the API and the web app
run locally, you are signed in, and you know where each part of the monorepo
lives.

## Development Commands

1. Start Postgres only.

   ```bash
   docker compose up -d db
   ```

2. Start the API on :3000, with hot reload.

   ```bash
   cd apps/server && pnpm dev
   ```

3. Start the web app: the Vite dev server, which proxies `/api`.

   ```bash
   cd apps/web && pnpm dev
   ```

4. Open the web app. On first run it shows a setup screen: enter and confirm a
   password (12+ characters), then click **Create password**. You are signed in
   immediately.

To run the full suite and the type check:

```bash
pnpm test                        # full suite
pnpm typecheck
```

## Monorepo Layout

| Path | What it is |
| -- | -- |
| `apps/server` | Fastify + Drizzle (API backend) |
| `apps/web` | React 19 + Vite (web UI) |
| `apps/extension` | MV3, vanilla TypeScript (browser extension) |
| `apps/mcp` | MCP server (for any MCP-compatible client) |
| `apps/cli` | CLI tool for batch triage |
| `packages/shared` | Shared types and utilities |

## Authentication in development

The Vite dev server (`pnpm --filter @bukmark/web dev`) proxies `/api` to the
backend on `localhost:3000`, preserving same-origin for session cookies. Bearer
tokens work without any special configuration.

<details>
<summary>Reset the password and start over</summary>

```bash
pnpm --filter @bukmark/server auth:reset-owner
```

This deletes the owner and all sessions and shows the setup screen again.
Access tokens keep working unless you add `--revoke-tokens`
(`pnpm --filter @bukmark/server auth:reset-owner --revoke-tokens`).

</details>

## Static Asset Registration

`apps/server` serves `apps/web/dist` statically, and asset routes are
registered at boot. After `pnpm --filter @bukmark/web build`, restart the
server or new bundles fall through to the SPA fallback.

## Fetching Preview Images

Adding a bookmark fetches its `og:image` server-side, behind an SSRF guard, so
a saved link can't be used to scan or attack services on your LAN or cloud
infrastructure. The fetcher:

- blocks private, loopback, link-local (including the cloud metadata endpoint
  `169.254.169.254`) and CGNAT ranges;
- follows redirects manually and re-validates every hop, so a chain of
  redirects can't bypass the guard;
- caps both time and body size.
