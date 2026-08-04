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

## Usage

- **Toolbar button** — save the current tab with an optional note on why it's
  worth keeping. Re-saving a page you already have tells you so.
- **`Cmd+Shift+S`** / **`Ctrl+Shift+S`** — save silently, no popup, no note.
- **Options → Import all bookmarks** — one-shot import of your browser's
  bookmarks. Everything arrives unsorted; the folder each came from is kept as a
  *hint* for sorting later, never applied automatically. Safe to re-run: existing
  links aren't duplicated and anything you deleted here stays deleted.
