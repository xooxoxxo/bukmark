---
title: Documentation
description: Install bukmark, connect the browser extension, sort with an MCP client, and get your data back out.
sidebar:
  order: 0
---

Bukmark is a self-hosted bookmark manager built around triage rather than storage:
capture a page in one click, and everything lands **unsorted** on purpose. These
steps take you from install to sorted, and back out.

## Getting Started

1. **[Install](/docs/install)** the server: one command, Homebrew, or Docker
   Compose from source.
2. **Capture** with the [browser extension](/docs/extension) for Chrome, Edge,
   Firefox and Safari, which also imports and syncs your bookmarks, or
   [from your phone](/docs/phone) with Android's Share sheet, an iOS Shortcut, or
   a bookmarklet.
3. **Sort** later, as a separate, deliberate pass: ask your AI assistant through
   [any MCP client](/docs/sorting). Not a decision you make at 1am with sixty
   tabs open.
4. **Take your data out** as HTML, JSON, or CSV, or bring bookmarks in from a
   browser file ([Import & Export](/docs/export)).

## What you keep

- **The page, not just the link.** The server reads each saved page in the
  background and keeps its text, so search finds words inside the page, not only
  its title, and the text stays if the page disappears. A link's **Edit** dialog
  shows the saved copy.
- **Broken links, found for you.** Pages are checked again every 30 days. One
  that answers 404 or 410, or whose domain no longer exists, shows up under
  **Broken links** in the sidebar; a site that just turns bots away doesn't.
- **Every link editable.** A link's **Edit** dialog has title, note, hubs,
  relevance, archive and delete. The list sorts by relevance, newest, oldest or
  title.
- **The passage, not just the page.** Select text and save it as a quote from
  the extension or your phone; it keeps its source and is searchable
  ([Quotes](/docs/quotes)).
- **Your hubs in your bookmarks.** The extension can keep a **bukmark** folder in
  your browser's bookmarks and your server the same, both ways
  ([Sync](/docs/extension/#sync-with-your-bookmarks)).

Only public addresses are ever fetched. Set `BUKMARK_CHECK_PAGES=false` to turn
the background reading off ([Install](/docs/install/#environment-variables)).

## Reference

- **[API reference](/docs/api)**: every REST endpoint bukmark serves, with parameters and response schemas.
- **[CLI](/docs/cli)**: batch-triage a OneTab export with the v0 CLI tool.
- **[Development](/docs/development)**: set up a local development environment and understand the monorepo.
- **[Privacy](/docs/privacy)**: what the extension sends and when, what your server keeps, and what this site loads.
