---
title: Documentation
description: Install bukmark, connect the browser extension, sort with an MCP client, and get your data back out.
sidebar:
  order: 0
---

Bukmark is a self-hosted bookmark manager built around triage rather than storage.
Capture a page in one click, and everything lands **unsorted** on purpose — sorting
is a separate, deliberate pass you run later by asking your AI assistant, not a decision you
make at 1am with sixty tabs open.

## What you keep

- **The page, not just the link.** The server reads each saved page in the
  background and keeps its text. Search finds words from inside the page, not
  only its title, and the text stays with you if the page later disappears.
  Open a link's **Edit** dialog to read the saved copy.
- **Broken links, found for you.** Pages are checked again every 30 days. A page
  that answers 404 or 410, or whose domain no longer exists, shows up under
  **Broken links** in the sidebar. A site that just turns bots away doesn't.
- **Every link editable.** Title, note, hubs, relevance, archive and delete are
  in each link's **Edit** dialog; the list sorts by relevance, newest, oldest or
  title.

Only public addresses are ever fetched. Set `BUKMARK_CHECK_PAGES=false` to turn
the background reading off ([Install](/docs/install/#environment-variables)).

## Getting Started

- **[Install](/docs/install)** — Run bukmark with Docker Compose in four commands
- **[Browser Extension](/docs/extension)** — The capture extension for Chrome, Edge, Firefox and Safari, with bookmark import
- **[Capture from your phone](/docs/phone)** — Android's Share sheet, an iOS Shortcut, or a bookmarklet
- **[Sorting with MCP](/docs/sorting)** — Use any MCP client to intelligently sort your bookmarks
- **[Import & Export](/docs/export)** — Bring bookmarks in from your browser; take your data out as HTML, JSON, or CSV
- **[API reference](/docs/api)** — Every REST endpoint bukmark serves, with parameters and response schemas
- **[CLI](/docs/cli)** — Batch-triage exports from OneTab, Chrome, or Safari using the v0 CLI tool
- **[Development](/docs/development)** — Set up a local development environment and understand the monorepo
- **[Privacy](/docs/privacy)** — What the extension sends and when, what your server keeps, and what this site loads
