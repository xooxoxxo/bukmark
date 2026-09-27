---
title: Development
description: Set up a local development environment and understand the bukmark monorepo.
sidebar:
  order: 7
---

## Development Commands

```bash
docker compose up -d db          # Postgres only
cd apps/server && pnpm dev       # API on :3000, hot reload
cd apps/web && pnpm dev          # Vite dev server, proxies /api
pnpm test                        # full suite
pnpm typecheck
```

## First run and authentication

On first run, the web app shows a setup screen: enter and confirm a password
(12+ characters), then click **Create password**. You are signed in immediately.

The Vite dev server (`pnpm --filter @bukmark/web dev`) proxies `/api` to the
backend on `localhost:3000`, preserving same-origin for session cookies. Bearer
tokens work without any special configuration.

To reset and start over, run:

```bash
pnpm --filter @bukmark/server auth:reset-owner
```

This deletes the owner and all sessions and shows the setup screen again.
Access tokens keep working unless you add `--revoke-tokens`
(`pnpm --filter @bukmark/server auth:reset-owner --revoke-tokens`).

## Monorepo Layout

Bukmark is organized as a monorepo with the following structure:

- `apps/server` — Fastify + Drizzle (API backend)
- `apps/web` — React 19 + Vite (web UI)
- `apps/extension` — MV3, vanilla TypeScript (browser extension)
- `apps/mcp` — MCP server (for any MCP-compatible client)
- `apps/cli` — CLI tool for batch triage
- `packages/shared` — shared types and utilities

## Static Asset Registration

`apps/server` serves `apps/web/dist` statically, and asset routes are
registered at boot. After `pnpm --filter @bukmark/web build`, restart the
server or new bundles fall through to the SPA fallback.

## Fetching Preview Images

Adding a bookmark fetches its `og:image` server-side. That fetcher blocks
private, loopback, link-local (including the cloud metadata endpoint
`169.254.169.254`) and CGNAT ranges, follows redirects manually and re-validates
every hop, and caps both time and body size — so a submitted URL can't be used to
reach services inside your network.

This SSRF guard ensures that saving a malicious link cannot be exploited as a
vector to scan or attack services on your LAN or cloud infrastructure. Every
redirect is re-validated against the blocked ranges, preventing attackers from
using a chain of redirects to bypass the guard.
