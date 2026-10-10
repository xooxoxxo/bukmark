---
title: Documentation
description: Install bukmark, connect the browser extension, sort with an MCP client, and get your data back out.
sidebar:
  order: 0
---

Bukmark is a self-hosted bookmark manager. Capture a page in one click; it lands
**unsorted**, and you sort later.

## Getting started

1. **[Install](/docs/install)** the server: one command, Homebrew, or Docker
   Compose from source.
2. **Capture** with the [browser extension](/docs/extension) (Chrome, Edge,
   Firefox, Safari), which also imports and syncs your bookmarks, or
   [from your phone](/docs/phone).
3. **Sort** with your AI assistant through [any MCP client](/docs/sorting).
4. **Import and export** as HTML, JSON or CSV ([Import & Export](/docs/export)).

## What you get

- **Full-text search** of each saved page, kept even if the page disappears.
- **Broken links** in the sidebar. Pages are re-checked every 30 days.
- **[Quotes](/docs/quotes)**: save a selected passage with its source.
- **[Bookmark sync](/docs/extension/#sync-with-your-bookmarks)** with a
  **bukmark** folder in your browser.

`BUKMARK_CHECK_PAGES=false` turns background page reading off
([Install](/docs/install/#environment-variables)).

## Reference

- **[API reference](/docs/api)**: every REST endpoint.
- **[CLI](/docs/cli)**: batch-triage a OneTab export with the v0 CLI.
- **[Development](/docs/development)**: run bukmark from a checkout.
- **[Privacy](/docs/privacy)**: what the extension sends, what your server keeps, and what this site loads.
