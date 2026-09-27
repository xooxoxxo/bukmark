---
title: Install
description: Run bukmark with Docker Compose in four commands.
sidebar:
  order: 1
---

## Requirements

- Docker and Docker Compose
- Node.js >= 22 and pnpm 10 (only for the extension build and the CLI)

## Quickstart

```bash
git clone https://github.com/xooxoxxo/bukmark.git bukmark && cd bukmark
cp .env.example .env          # optional — defaults work as-is
docker compose up -d
curl localhost:3000/healthz   # {"ok":true}
```

That builds the server image, starts Postgres, applies migrations on boot, and
serves the API and web UI on `http://localhost:3000`. Open it and
[set your password](#first-run-setup) straight away.

## Port Configuration

If port 5432 or 3000 is already in use, set `POSTGRES_PORT` and/or `PORT`
to free ports in `.env` before running `docker compose up`.

## Environment Variables

These variables control bukmark's behavior. Every value below has a working default, so
`docker compose up -d` works with no `.env` at all — `.env` is for changing them.

```
POSTGRES_PASSWORD=
POSTGRES_PORT=
PORT=
CORS_ORIGINS=
TRUST_PROXY=
```

**POSTGRES_PASSWORD** — Postgres password. Compose publishes the database on
`127.0.0.1` only, so nothing outside this machine can reach it; that is what
makes the default acceptable. Change it before you publish the database any wider.

**POSTGRES_PORT** — Port the Postgres database is published on, on the host's
`127.0.0.1`. Change this only if you already run Postgres locally on 5432 and want to
avoid conflict. The app always reaches it at `db:5432` over the compose network.

**PORT** — Port the API and web UI are served on, on the host.

**CORS_ORIGINS** — Browser-extension origins allowed to call the API, comma-separated.
Empty (the default) registers no CORS at all, which is correct until you
actually load the extension. Then put its origin here:
`CORS_ORIGINS=chrome-extension://your-extension-id-here`

**TRUST_PROXY** — `true` only when a reverse proxy is the sole way to reach
bukmark; `false` by default. See [Behind a reverse proxy](#behind-a-reverse-proxy).

## First-run setup

The server has one owner password, created on your first visit to the web UI.
Open `http://localhost:3000` (or wherever you serve it), enter a password of
12–1024 characters twice, and click **Create password**. You are signed in
straight away.

**Set the password immediately after installing.** Until it is set, whoever
reaches the server first can claim it. Meanwhile every `/api` request returns
`401` with the code `setup_required`.

## Access tokens

Anything that calls the API from outside the web app needs an access token:

- **MCP server** — set `BUKMARK_API_TOKEN` so any MCP client (Claude Code,
  Cursor, etc.) can read and sort your unsorted bookmarks. See
  [Sorting with MCP](/docs/sorting/).
- **Scripts and tools** — send the token as `Authorization: Bearer <token>`.
  See the [API reference](/docs/api/#authentication).

To create one, open **Settings → Access tokens** in the web app, enter a name
under *New token*, and click **Create token**. Copy it straight away — the page
shows it only once. Revoke tokens you no longer use on the same page.

The browser extension creates its own token when you log in; it appears in the
list as "bukmark capture".

## Forgotten password

To reset the owner password (for example, if it's lost):

```bash
# Local development
pnpm --filter @bukmark/server auth:reset-owner

# Docker
docker compose exec app node_modules/.bin/tsx apps/server/src/auth/resetOwner.ts
```

This deletes the owner and all sessions, so the web app shows the setup screen
again: open it and set a new password straight away. Until you do, every API
request is refused with `setup_required` — including access tokens. Tokens you
kept start working again once the new password is set. To delete them as well,
add `--revoke-tokens` to either command.

## Behind a reverse proxy

To serve bukmark over HTTPS, put it behind nginx, Caddy or Traefik. Three
things matter.

**Forward the original `Host` header.** The server refuses a browser request
that changes something — setting the password, logging in, allowing the
extension, any edit in the web app — unless its `Origin` matches the `Host`
header the server receives. Caddy and Traefik pass `Host` through unchanged;
nginx replaces it with the upstream address unless you add
`proxy_set_header Host $host;` (`$http_host` if your public URL has a port in
it). Without it, even setting the password fails with "Cross-site request
refused".

**Set `TRUST_PROXY=true`** in `.env`, then run `docker compose up -d` again:

```bash
TRUST_PROXY=true
```

The server then reads the original scheme from `X-Forwarded-Proto`, so the
session cookie is marked `Secure` over HTTPS, and the client's address from
`X-Forwarded-For`, so the login rate limit counts each client separately.
Without it, logging in still works, but the cookie is not marked `Secure`, and
every client shares the proxy's address: ten wrong passwords from anyone lock
everyone out of logging in for up to 15 minutes.

**Make the proxy the only way in.** With `TRUST_PROXY=true` the server believes
whatever `X-Forwarded-For` says, so a client that reaches the app port directly
can claim a new address for every guess and never hit the rate limit. When the
proxy runs on the same machine, publish the app on loopback only: in
`docker-compose.yml`, change the app's `ports` entry to
`"127.0.0.1:${PORT:-3000}:3000"`. The proxy must also set `X-Forwarded-For` to
the client's address rather than append to whatever the client sent.

A minimal nginx `location` block with those headers:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

## Upgrading from a version without auth

1. Pull and rebuild. The app image is built from your checkout, so without
   `--build` Compose keeps running the old, unauthenticated version:

   ```bash
   git pull && docker compose up -d --build
   ```

2. Open the web app and set a password on the setup screen. Until you do, every
   `/api` request returns `401` with `setup_required`; after that, anything
   outside the web app needs credentials, so the old extension, the MCP server
   and your scripts stop working until you finish the steps below.
3. Rebuild the extension (`pnpm install && pnpm --filter @bukmark/extension build`),
   reload it in `chrome://extensions`, then open it and click **Log in** — see
   [Logging in](/docs/extension/#logging-in).
4. If you use the MCP server, create a token under **Settings → Access tokens**
   and set `BUKMARK_API_TOKEN` in your MCP client config.
5. Give scripts that call the API a token too:
   `curl -f -H "Authorization: Bearer <token>" …` — for example the
   [export commands](/docs/export/#export-examples).

Compose now also publishes Postgres on `127.0.0.1` only. If something on another
machine read the database directly, it no longer can.
