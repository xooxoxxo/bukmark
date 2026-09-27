---
title: Browser Extension
description: Chrome and Brave extension for quick capturing and bookmark import.
sidebar:
  order: 2
---

## Build

```bash
pnpm install
pnpm --filter @bukmark/extension build   # → apps/extension/dist
```

## Load Into Your Browser

In Chrome or Brave: open `chrome://extensions` (or `brave://extensions`),
turn on **Developer mode**, choose **Load unpacked**, and select
`apps/extension/dist`.

## Default URL

The extension talks to `http://localhost:3000` by default. Running the server
elsewhere? Open the extension's options page and set the URL — your browser will
ask permission for that address the first time you save it.

## CORS Configuration

**If the server runs on a different host from the browser**, add the extension's
origin to `CORS_ORIGINS` in `.env` and restart, or every request fails at the
CORS preflight:

```bash
# Copy the ID from chrome://extensions
CORS_ORIGINS=chrome-extension://your-extension-id-here
```

## Logging in

The extension saves nothing until it is logged in to your server.

1. Click the extension's toolbar button. While logged out, the popup shows only
   a **Server** field and a **Log in** button.
2. Check the **Server** field — it defaults to `http://localhost:3000` — and
   click **Log in**. The first time, your browser asks permission to reach that
   address.
3. A small window opens on your server. If you are not signed in to the web app
   in this browser, it asks for your bukmark password first.
4. The window then shows "bukmark capture wants to save bookmarks to this
   server", the extension's ID, and what it will be able to do: add and read
   your links and hubs. Check the ID against the one on the extension's card in
   `chrome://extensions`, then click **Allow**, or **Deny** to cancel.

When the window closes, the toolbar badge flashes ✓, and from then on the popup
shows the save form with a "Signed in to …" line at the bottom. The options
page has the same **Log in** button, under **Server**.

If the server has no owner password yet, the window says so and asks you to
open the web app and create one first.

The login belongs to that server: the extension only ever sends its token to
the server that issued it, and changing the server URL logs you out.

## Logging out

On the extension's options page, click **Log out** under **Server**. The
extension asks the server to revoke its token, then forgets the token either
way. If the server can't be reached, the extension still logs out locally, but
the token stays valid on the server until you revoke **bukmark capture** under
**Settings → Access tokens** in the web app.

Saving a different server URL on the options page while logged in logs out the
same way first.

## Usage

- **Toolbar button** — save the current tab with an optional note on why it's
  worth keeping. Re-saving a page you already have tells you so. While logged
  out, the popup shows the **Log in** form instead.
- **`Cmd+Shift+S`** / **`Ctrl+Shift+S`** — save silently, no popup, no note.
  While logged out, nothing is sent and the badge shows `!`.
- **Options → Server** — change the server URL, log in, or log out.
- **Options → Import all bookmarks** — one-shot import of your browser's
  bookmarks. Everything arrives unsorted; the folder each came from is kept as a
  *hint* for sorting later, never applied automatically. Safe to re-run: existing
  links aren't duplicated and anything you deleted here stays deleted. You must be
  logged in.

## Token revocation

The extension's token is listed in the web app under
**Settings → Access tokens** as "bukmark capture". Once you click **Revoke**
there, the extension's next request is refused, it forgets the token, and the
popup shows the **Log in** form with "Your session ended — log in again".
