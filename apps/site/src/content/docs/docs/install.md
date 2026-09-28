---
title: Install
description: Install bukmark with one command, with Homebrew, or with Docker Compose from source.
sidebar:
  order: 1
---

bukmark runs in Docker, on your own computer or server. There are three ways to
set it up. The install script and Homebrew give you the
[`bukmark` command](#the-bukmark-command), which runs the published image, so
nothing is built on your machine. Docker Compose from source builds the image
from a checkout.

## Requirements

- Docker with Compose v2 (`docker compose`), and it has to be running.
  - macOS: Docker Desktop, OrbStack or Colima.
  - Linux: Docker Engine with the Compose plugin.
- git, for Docker Compose from source.
- Node.js >= 22 and pnpm 10, only to [build the extension](/docs/extension/#build)
  and for the v0 [triage CLI](/docs/cli/).

## Install

:::note[Coming with the first release]
The install script and Homebrew need the first published release. Until it is
out, use [Docker Compose from source](#docker-compose-from-source).
:::

### Install script

```bash
curl -fsSL https://bukmark.it/install.sh | sh
```

The script checks that Docker is running, puts the `bukmark` command in
`~/.local/bin`, and runs `bukmark setup`. It installs into your home folder
only and never uses sudo. If `~/.local/bin` is not on your `PATH`, it prints
the line that adds it.

To choose the port, pass options for `bukmark setup` after `sh -s --`:

```bash
curl -fsSL https://bukmark.it/install.sh | sh -s -- --port 3001
```

You can read [the script](https://bukmark.it/install.sh) and
[the command it installs](https://bukmark.it/bukmark) before you run them.
To install the command into another folder, set `BUKMARK_BIN_DIR` for `sh`.

### Homebrew

```bash
brew install xooxoxxo/tap/bukmark
bukmark setup
```

Homebrew installs the `bukmark` command, not Docker. Install it by the full
name, as above: Homebrew then trusts this one formula from the tap. After
`brew tap xooxoxxo/tap`, the short name `bukmark` works only once you run
`brew trust --formula xooxoxxo/tap/bukmark`.

### Docker Compose from source

For building the image yourself, or changing the code:

```bash
git clone https://github.com/xooxoxxo/bukmark.git bukmark && cd bukmark
cp .env.example .env          # optional — defaults work as-is
docker compose up -d
curl localhost:3000/healthz   # {"ok":true}
```

That builds the server image, starts Postgres, applies migrations on boot, and
serves the API and web UI on `http://localhost:3000`. Settings go in `.env` in
the checkout; see [Environment variables](#environment-variables).

If port 5432 or 3000 is already in use, set `POSTGRES_PORT` and/or `PORT`
to free ports in `.env` before running `docker compose up`.

To update, pull and rebuild. Without `--build`, Compose keeps running the image
it built before:

```bash
git pull && docker compose up -d --build
```

### After installing

Open `http://localhost:3000`, or the port you chose, and
[set your password](#first-run-setup) straight away. Then
[add the browser extension](/docs/extension/) and log in to the same address.

## The bukmark command

The install script and Homebrew both install `bukmark`, one shell script that
runs bukmark with Docker Compose. `bukmark help` lists its commands:

| Command | What it does |
| --- | --- |
| `bukmark setup` | Writes your settings, downloads the images, starts bukmark and waits until it answers. `--port N` picks the port. `--lan` lets other devices on your network reach it; `--local` makes it this machine only again (the default). Safe to run again: it keeps your settings. |
| `bukmark start` | Starts bukmark. |
| `bukmark stop` | Stops bukmark. Your data is kept. |
| `bukmark restart` | Restarts bukmark, with any changes to `.env`. |
| `bukmark status` | Shows whether bukmark is running. Exits 0 when it is, 3 when it is stopped or not set up, and 1 when it runs but does not answer. |
| `bukmark logs` | Shows the server's logs. `-f` keeps following them. |
| `bukmark update` | Downloads the newest image and restarts. Your data is kept. |
| `bukmark open` | Opens bukmark in your browser. |
| `bukmark uninstall` | Removes bukmark's containers. Your data is kept. With `--delete-data`, it also deletes all your bookmarks and settings, after you type `delete`; `--yes` skips that question. |
| `bukmark version` | Prints the command's version. |
| `bukmark help` | Lists the commands. |

### Where your data lives

Everything is in one folder, `~/.bukmark`:

- `.env` holds your settings. `bukmark setup` writes it once, readable by you
  only. Run again, it changes only `BUKMARK_LISTEN`, and only when you pass
  `--lan` or `--local`.
- `compose.yml` is written by the command on every run. Don't edit it; your
  changes would be replaced.
- `compose.override.yml` is yours and optional, for a change `.env` can't
  make. The command loads it after `compose.yml`.
  [Behind a reverse proxy](#behind-a-reverse-proxy) has an example.

Your bookmarks are in the Docker volume `bukmark-cli_pgdata`. Keep `.env` with
it: it holds the database password, and the data opens only with that password.
If the volume is there but `.env` is gone, `bukmark setup` stops rather than
lock you out. The command's containers and volume are named `bukmark-cli`, so a
checkout run with Docker Compose never touches them, nor they it.

To use another folder, export `BUKMARK_HOME` in your shell profile, so every
`bukmark` command finds it.

### Settings

`~/.bukmark/.env` holds the same settings as `.env` in a checkout, described
under [Environment variables](#environment-variables), with these differences:

- `POSTGRES_PASSWORD` is made up at random by `bukmark setup`. Don't change it:
  the database keeps the password it started with, so a new one locks the app
  out.
- `PORT` comes from `bukmark setup --port`, or `BUKMARK_PORT`, and is 3000 by
  default.
- `POSTGRES_PORT` is not used. The database has no port on your machine at
  all; only the app reaches it.
- `CORS_ORIGINS` is not used. It is only for a web dev server, which runs from
  a checkout.
- `BUKMARK_VERSION` is the server version to run: `latest`, the default, or a
  release such as `0.3.0`.
- `BUKMARK_LISTEN` decides who can reach bukmark. `127.0.0.1`, the default,
  is this machine only. `0.0.0.0` is every device that can reach this one, such
  as your phone on the same Wi-Fi. Switch with `bukmark setup --lan` and
  `bukmark setup --local`. Set your password before you open it up: until then,
  whoever opens the web app first sets it.

After changing a setting, run `bukmark restart`. The command reads `PORT`,
`POSTGRES_PASSWORD` and the other server settings from `.env` only: the same
names set in your shell are ignored, so another project's `PORT` can't change
bukmark's.

### Change the port

Choose it at setup with `bukmark setup --port 3001`, or through the install
script as shown [above](#install-script). If the port is taken, setup stops,
says so and suggests another.

To change it later, set `PORT` in `~/.bukmark/.env` and run `bukmark restart`.
Running `bukmark setup --port` again doesn't change it: setup keeps the port in
`.env` and tells you so.

The extension expects `http://localhost:3000`. On another port, enter the
address when you log in to the extension.

### Update

```bash
bukmark update
```

This downloads the newest image for `BUKMARK_VERSION` and restarts bukmark on
it. Your data is kept, and the server brings its database up to date as it
starts. If the download fails, the version you had keeps running and the
command exits 1.

To stay on one release, set `BUKMARK_VERSION` in `~/.bukmark/.env` to it, such
as `0.3.0`, and run `bukmark update`.

That updates the server. To update the command itself, run
`brew upgrade bukmark`, or the install script again. The script keeps your
settings and data.

### Uninstall

```bash
bukmark uninstall
```

This removes bukmark's containers. Your bookmarks stay in the Docker volume
and your settings in `~/.bukmark`, so `bukmark start` brings everything back.

```bash
bukmark uninstall --delete-data
```

This also deletes the volume, with every bookmark in it, and bukmark's files in
`~/.bukmark`. It asks you to type `delete` first; `--yes` skips the question.

Then remove the command itself: `brew uninstall bukmark`, or delete
`~/.local/bin/bukmark`. Docker keeps the images it downloaded; remove them with
`docker image rm` if you want the space back.

## Environment Variables

These variables control bukmark's behavior. From source, they go in `.env` in
the checkout. Every value below has a working default, so `docker compose up -d`
works with no `.env` at all — `.env` is for changing them. The `bukmark`
command keeps them in `~/.bukmark/.env`; [Settings](#settings) lists what
differs there.

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
The `bukmark` command makes up a random one and gives the database no port at all.

**POSTGRES_PORT** — Port the Postgres database is published on, on the host's
`127.0.0.1`. Change this only if you already run Postgres locally on 5432 and want to
avoid conflict. The app always reaches it at `db:5432` over the compose network.
The `bukmark` command doesn't use it.

**PORT** — Port the API and web UI are served on, on the host.

**CORS_ORIGINS** — Other web origins allowed to read API responses from a
browser, comma-separated, for example `CORS_ORIGINS=http://localhost:5173`.
Empty (the default) registers no CORS at all, which is what bukmark itself
needs: the web app is served from the same origin, and the browser extension
reaches the server through the host access you grant it, not through CORS.
The `bukmark` command doesn't use it.

**TRUST_PROXY** — `true` only when a reverse proxy is the sole way to reach
bukmark; `false` by default. See [Behind a reverse proxy](#behind-a-reverse-proxy).

**BUKMARK_EXTENSION_IDS** — The browser-extension builds the login page
recognises, comma-separated: Chrome extension IDs and Firefox ID hashes. Empty
(the default) knows the official Firefox add-on and warns about any other
Firefox add-on; Chrome and Edge extensions get no warning until you set a list.
A client the list doesn't name still gets **Allow**, with an "Unrecognised
extension" warning. See
[Unrecognised extension](/docs/extension/#unrecognised-extension).

**BUKMARK_CHECK_PAGES** — `true` (the default) lets the server fetch each saved
page in the background, about 20 a minute, re-checking every 30 days. It keeps
the page's text, so search finds words from inside the page and you keep a copy
if the page later disappears, and it marks pages that are gone as broken. Only
public addresses are fetched. `false` stops the background checks. The server
then fetches a page only when asked: once when it is saved, for its preview
image; after an import from the extension, for preview images; and when you
start a check yourself (`POST /api/links/check`).

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

# Docker Compose from source, in the checkout
docker compose exec app node_modules/.bin/tsx apps/server/src/auth/resetOwner.ts

# The bukmark command
cd ~/.bukmark && docker compose exec app node_modules/.bin/tsx apps/server/src/auth/resetOwner.ts
```

This deletes the owner and all sessions, so the web app shows the setup screen
again: open it and set a new password straight away. Until you do, every API
request is refused with `setup_required` — including access tokens. Tokens you
kept start working again once the new password is set. To delete them as well,
add `--revoke-tokens` to any of these commands.

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

**Set `TRUST_PROXY=true`** in `.env`:

```bash
TRUST_PROXY=true
```

Then run `docker compose up -d` again. With the `bukmark` command, the file is
`~/.bukmark/.env`, and `bukmark restart` applies it.

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
`"127.0.0.1:${PORT:-3000}:3000"`. With the `bukmark` command, leave its
`compose.yml` alone, since it rewrites that file on every run. Create
`~/.bukmark/compose.override.yml` instead, then run `bukmark restart`:

```yaml
services:
  app:
    ports: !override ["127.0.0.1:${PORT:-3000}:3000"]
```

The proxy must also set `X-Forwarded-For` to the client's address rather than
append to whatever the client sent.

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

This is for Docker Compose from source. The published image, which the
`bukmark` command runs, has had auth since its first release.

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
