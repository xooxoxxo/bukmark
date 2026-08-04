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
serves the API and web UI on `http://localhost:3000`.

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
```

**POSTGRES_PASSWORD** — Postgres password. Change this if the database is reachable by anything but
you; it is only a safe default because the stack binds to localhost.

**POSTGRES_PORT** — Port the Postgres database is exposed on, on the host.
Change this only if you already run Postgres locally on 5432 and want to
avoid conflict. The app always reaches it at `db:5432` over the compose network.

**PORT** — Port the API and web UI are served on, on the host.

**CORS_ORIGINS** — Browser-extension origins allowed to call the API, comma-separated.
Empty (the default) registers no CORS at all, which is correct until you
actually load the extension. Then put its origin here:
`CORS_ORIGINS=chrome-extension://your-extension-id-here`

## Authentication Warning

> **The API has no authentication.** None, on any route. It is built to run on a
> trusted network — your LAN, or a Tailscale tailnet — and it must not be exposed
> to the internet. There is no login to add; anyone who can reach the port has
> full read and write access to your bookmarks.

This is the single most important security constraint: bukmark is not designed for
public internet exposure. Use it only on networks you control.
