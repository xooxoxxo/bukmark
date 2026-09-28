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
BUKMARK_EXTENSION_IDS=
BUKMARK_CHECK_PAGES=
```

**POSTGRES_PASSWORD** — Postgres password. Compose publishes the database on
`127.0.0.1` only, so nothing outside this machine can reach it; that is what
makes the default acceptable. Change it before you publish the database any wider.

**POSTGRES_PORT** — Port the Postgres database is published on, on the host's
`127.0.0.1`. Change this only if you already run Postgres locally on 5432 and want to
avoid conflict. The app always reaches it at `db:5432` over the compose network.

**PORT** — Port the API and web UI are served on, on the host.

**CORS_ORIGINS** — Other web origins allowed to read API responses from a
browser, comma-separated, for example `CORS_ORIGINS=http://localhost:5173`.
Empty (the default) registers no CORS at all, which is what bukmark itself
needs: the web app is served from the same origin, and the browser extension
reaches the server through the host access you grant it, not through CORS.

**TRUST_PROXY** — `true` only when a reverse proxy is the sole way to reach
bukmark; `false` by default. See [Behind a reverse proxy](#behind-a-reverse-proxy).

**BUKMARK_EXTENSION_IDS** — The browser-extension builds the login page
recognises, comma-separated: Chrome extension IDs and Firefox ID hashes. Empty
(the default) knows only the official Firefox add-on. Any other client still
gets **Allow**, with an "Unrecognised extension" warning. See
[Unrecognised extension](/docs/extension/#unrecognised-extension).

**BUKMARK_CHECK_PAGES** — `true` (the default) lets the server fetch each saved
page in the background, about 20 a minute, re-checking every 30 days. It keeps
the page's text, so search finds words from inside the page and you keep a copy
if the page later disappears, and it marks pages that are gone as broken. Only
public addresses are fetched. `false` stops all of it; links are then fetched
only once, for their preview image, when they are saved.

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
list as "bukmark capture". An [iOS Shortcut](/docs/phone/#ios-shortcut) needs a
token of its own.

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

## HTTPS

bukmark works over plain `http://` on a LAN or tailnet address: the web app,
the browser extension and the API all run in the browser as they are. Some
things need HTTPS, though:

- **Installing the web app.** Browsers install a web app — and so show it in
  Android's Share sheet — only from an `https://` address (or `localhost`).
  Over plain HTTP it keeps working in a browser tab but cannot be installed.
  See [Capture from your phone](/docs/phone/).
- **A `Secure` session cookie.** The server marks the cookie `Secure` only when
  the request arrived over HTTPS; over plain HTTP it travels unprotected.
- **Access tokens sent over a network**, such as an iOS Shortcut's, which anyone
  on the path can read over plain HTTP.

To serve HTTPS, put bukmark behind a reverse proxy.

## Behind a reverse proxy

To serve bukmark over HTTPS, put it behind nginx, Caddy or Traefik. Four
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

**Keep the login code out of the proxy's log.** In browsers without an
extension login window, such as Safari and Firefox for Android, the extension's
login ends on `/authorize/done?code=…&state=…` (see
[Which window opens](/docs/extension/#which-window-opens)). The code works
once, for two minutes, and only with a secret held by whoever started the
login; your own extension redeems it at once. The danger is a login someone
else started: if they trick you into allowing it and can read your proxy's
log, the log hands them the code, and the code gets them an access token.
bukmark keeps the query out of its own log; the proxy has to as well.

- **nginx** logs every request line in full by default. The second block below
  turns its log off for that one path, and repeats the proxy lines because one
  `location` doesn't inherit another's.
- **Caddy** and **Traefik** keep no access log unless you turn one on. If you
  have, skip that path: in Caddy, `log_skip /authorize/done` (`skip_log` before
  Caddy 2.8); in Traefik 3.3 or later, a router of its own for that path with
  `observability.accessLogs: false`.

A minimal nginx configuration with all of that:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
}

location = /authorize/done {
    access_log off;
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
   remove the old copy from your browser's extensions page, and load the new
   one from your browser's folder under `apps/extension/dist` — see
   [Load Into Your Browser](/docs/extension/#load-into-your-browser). Then open
   it and click **Log in** — see [Logging in](/docs/extension/#logging-in).
4. If you use the MCP server, create a token under **Settings → Access tokens**
   and set `BUKMARK_API_TOKEN` in your MCP client config.
5. Give scripts that call the API a token too:
   `curl -f -H "Authorization: Bearer <token>" …` — for example the
   [export commands](/docs/export/#export-examples).

Compose now also publishes Postgres on `127.0.0.1` only. If something on another
machine read the database directly, it no longer can.
