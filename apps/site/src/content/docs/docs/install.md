---
title: Install
description: Install bukmark with one command, with Homebrew, or with Docker Compose from source.
sidebar:
  order: 1
---

Run bukmark in Docker on your own computer or server.

## Requirements

- Docker with Compose v2 (`docker compose`), running: Docker Desktop, OrbStack
  or Colima on macOS; Docker Engine with the Compose plugin on Linux.
- git, for Docker Compose from source.
- Node.js >= 22 and pnpm 10, only to [build the extension](/docs/extension/#build)
  and for the [triage CLI](/docs/cli/).

## Install

Pick one way, then do [First-run setup](#first-run-setup).

### Install script

```bash
curl -fsSL https://bukmark.it/install.sh | sh
```

This puts the [`bukmark` command](#the-bukmark-command) in `~/.local/bin` and
runs `bukmark setup`. It installs into your home folder and never uses sudo.

- Another port: `curl -fsSL https://bukmark.it/install.sh | sh -s -- --port 3001`
- Another folder for the command: set `BUKMARK_BIN_DIR`.
- To read them first: [the script](https://bukmark.it/install.sh),
  [the command](https://bukmark.it/bukmark).

### Homebrew

```bash
brew install xooxoxxo/tap/bukmark
bukmark setup
```

Homebrew installs the `bukmark` command, not Docker.

### Docker Compose from source

```bash
git clone https://github.com/xooxoxxo/bukmark.git bukmark && cd bukmark
cp .env.example .env          # optional — defaults work as-is
docker compose up -d
curl localhost:3000/healthz   # {"ok":true}
```

bukmark now runs on `http://localhost:3000`. Ports 3000 or 5432 taken? Set
`PORT` / `POSTGRES_PORT` in `.env`.

To update: `git pull && docker compose up -d --build`.

## First-run setup

1. Open `http://localhost:3000` (or your port or address).
2. Enter a password of 12–1024 characters twice and click **Create password**.
3. [Add the browser extension](/docs/extension/) and log in to the same address.

:::caution[Set the password right away]
Until it is set, whoever reaches the server first can claim it, and every `/api`
request returns `401` with `setup_required`.
:::

## The bukmark command

The install script and Homebrew both install `bukmark`. `bukmark help` lists its
commands:

| Command | What it does |
| --- | --- |
| `bukmark setup` | Writes settings, downloads the images, starts bukmark. `--port N` sets the port; `--lan` opens it to your network; `--local` (default) limits it to this machine. Safe to rerun. |
| `bukmark start` | Starts bukmark. |
| `bukmark stop` | Stops bukmark. Data is kept. |
| `bukmark restart` | Restarts bukmark, applying changes to `.env`. |
| `bukmark status` | Exits 0 when bukmark is running, 3 when it is stopped or not set up, 1 when it runs but does not answer. |
| `bukmark logs` | Shows the server's logs. `-f` keeps following them. |
| `bukmark update` | Backs up the database, downloads the newest image and restarts. Data is kept. `--latest` follows new releases again after a rollback. |
| `bukmark rollback` | Goes back to the version and database from before the last update. `--yes` skips the confirmation. |
| `bukmark open` | Opens bukmark in your browser. |
| `bukmark uninstall` | Removes the containers, keeping data. `--delete-data` deletes it too; `--yes` skips the confirmation. |
| `bukmark version` | Prints the command's version. |
| `bukmark help` | Lists the commands. |

### Where your data lives

Everything is in `~/.bukmark`, except your bookmarks:

| What | What it is for |
| --- | --- |
| `.env` | Your settings. Keep it with the volume: it holds the database password. |
| `compose.yml` | Rewritten on every run. Don't edit it. |
| `compose.override.yml` | Optional, yours, for changes `.env` can't make. See [Behind a reverse proxy](#behind-a-reverse-proxy). |
| Docker volume `bukmark-cli_pgdata` | Your bookmarks. |

To use another folder, export `BUKMARK_HOME` in your shell profile.

### Settings

`~/.bukmark/.env` takes the [environment variables](#environment-variables)
below, with these differences:

| Setting | With the `bukmark` command |
| --- | --- |
| `POSTGRES_PASSWORD` | Random, set by `bukmark setup`. Don't change it, or the app is locked out of the database. |
| `PORT` | From `bukmark setup --port` or `BUKMARK_PORT`. Default 3000. On another port, enter the address when you log in to the extension. |
| `POSTGRES_PORT` | Not used. |
| `CORS_ORIGINS` | Not used. |
| `BUKMARK_VERSION` | Server version to run: `latest` (default) or a release such as `0.3.0`. |
| `BUKMARK_LISTEN` | `127.0.0.1` (default): this machine only. `0.0.0.0`: your network. Switch with `bukmark setup --lan` or `bukmark setup --local`. Set your password first. |

Change settings in `.env`, not in your shell, then run `bukmark restart`.

### Update

**Settings → Updates** in the web app says when a new release is out, with
its notes and the command to run:

```bash
bukmark update
```

It backs up the database to `~/.bukmark/backups` first. To undo the last
update:

```bash
bukmark rollback
```

This restores that backup and stays on the version you had. To follow new
releases again: `bukmark update --latest`.

To stay on one release, set `BUKMARK_VERSION` first. To update the command
itself: `brew upgrade bukmark`, or rerun the install script.

### Uninstall

```bash
bukmark uninstall                 # data and settings stay; bukmark start brings it back
bukmark uninstall --delete-data   # also deletes every bookmark and ~/.bukmark
```

Then remove the command: `brew uninstall bukmark`, or delete
`~/.local/bin/bukmark`.

## Environment variables

Set these in `.env` in the checkout (`~/.bukmark/.env` for the `bukmark`
command; see [Settings](#settings)). The defaults:

```
POSTGRES_PASSWORD=bukmark
POSTGRES_PORT=5432
PORT=3000
CORS_ORIGINS=
TRUST_PROXY=false
BUKMARK_EXTENSION_IDS=
BUKMARK_CHECK_PAGES=true
BUKMARK_UPDATE_FEED=
```

- **`POSTGRES_PASSWORD`**: change it before you publish the database beyond
  `127.0.0.1`.
- **`POSTGRES_PORT`**, **`PORT`**: host ports for the database and the web app.
- **`CORS_ORIGINS`**: extra browser origins allowed to call the API,
  comma-separated, such as `http://localhost:5173`.
- **`TRUST_PROXY`**: see [Behind a reverse proxy](#behind-a-reverse-proxy).
- **`BUKMARK_EXTENSION_IDS`**: see
  [Unrecognised extension](/docs/extension/#unrecognised-extension).
- **`BUKMARK_CHECK_PAGES`**: `false` stops reading saved pages in the
  background.
- **`BUKMARK_UPDATE_FEED`**: `off` stops checking for new releases. Empty
  checks bukmark's GitHub releases.

## Access tokens

Anything that calls the API from outside the web app needs an access token.

1. Open **Settings → Access tokens** in the web app.
2. Enter a name under *New token* and click **Create token**.
3. Copy the token now. It is shown only once.

Revoke tokens on the same page.

The [MCP server](/docs/sorting/) takes it as `BUKMARK_API_TOKEN`; scripts send
`Authorization: Bearer <token>` ([API](/docs/api/#authentication)). The
browser extension creates its own at login, listed as "bukmark capture".

## Forgotten password

1. Reset the owner password:

   ```bash
   # The bukmark command
   cd ~/.bukmark && docker compose exec app node_modules/.bin/tsx apps/server/src/auth/resetOwner.ts

   # Docker Compose from source, in the checkout
   docker compose exec app node_modules/.bin/tsx apps/server/src/auth/resetOwner.ts

   # Local development
   pnpm --filter @bukmark/server auth:reset-owner
   ```

2. Open the web app and set a new password right away.

Access tokens keep working. To delete them too, add `--revoke-tokens` to the
command.

## HTTPS

Plain `http://` works on a LAN or tailnet address. You need HTTPS, from a
[reverse proxy](#behind-a-reverse-proxy), for:

- **Installing the web app**, and so Android's Share sheet. Browsers install it
  only from an `https://` address or `localhost`; over plain HTTP it
  cannot be installed. See [Capture from your phone](/docs/phone/).
- **A `Secure` session cookie.** The server marks it `Secure` only when
  the request arrived over HTTPS.
- **Access tokens sent over a network**, such as an iOS Shortcut's.

## Behind a reverse proxy

To serve bukmark over HTTPS through nginx, Caddy or Traefik:

1. **Forward the original `Host` header.** Without it, every sign-in fails with
   "Cross-site request refused".
2. **Set `TRUST_PROXY=true`** in `.env`, then run `docker compose up -d` again
   (with the `bukmark` command: `~/.bukmark/.env`, then `bukmark restart`).
3. **Make the proxy the only way in.** If the proxy runs on the same machine, in
   `docker-compose.yml` change the app's `ports` to
   `"127.0.0.1:${PORT:-3000}:3000"`. With the `bukmark` command, create
   `~/.bukmark/compose.override.yml` instead, then run `bukmark restart`:

   ```yaml
   services:
     app:
       ports: !override ["127.0.0.1:${PORT:-3000}:3000"]
   ```

   The proxy must set `X-Forwarded-For` to the client's address, not append to it.
4. **Keep `/authorize/done?code=…&state=…` out of the access log.** Its one-time
   code can be traded for an access token.

- **nginx:** add `proxy_set_header Host $host;` (`$http_host` if your public URL
  has a port), and turn the access log off for `/authorize/done`, as below.
- **Caddy:** passes `Host` through. If you turned access logs on, add
  `log_skip /authorize/done` (`skip_log` before Caddy 2.8).
- **Traefik:** passes `Host` through. If you turned access logs on, give that
  path its own router with `observability.accessLogs: false` (Traefik 3.3+).

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

For Docker Compose from source only.

1. Pull and rebuild:

   ```bash
   git pull && docker compose up -d --build
   ```

2. Open the web app and set a password.
3. Rebuild the extension, [load it again](/docs/extension/#load-into-your-browser)
   and [log in](/docs/extension/#logging-in):

   ```bash
   pnpm install && pnpm --filter @bukmark/extension build
   ```

4. Give the MCP server (`BUKMARK_API_TOKEN`) and your scripts an
   [access token](#access-tokens).

Postgres is now published on `127.0.0.1` only.
