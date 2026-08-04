---
title: Sorting with Claude (MCP)
description: Use Claude Code and MCP to intelligently sort your unsorted bookmarks.
sidebar:
  order: 3
---

Bukmark ships with an MCP (Model Context Protocol) server that lets Claude read your unsorted
bookmarks and file them into your hubs (categories), with your approval, from any Claude session.

## Setup

```bash
cp .mcp.json.example .mcp.json     # edit BUKMARK_API_URL if not localhost:3000
```

Edit the `.mcp.json` file to point to your bukmark API URL if it's not `http://localhost:3000`.

Restart Claude Code so it picks the config up.

## Using It

In Claude Code, ask it to *"sort my unsorted bukmark links"*. It will:

1. List what's unsorted along with your existing hubs
2. Propose assignments for each link
3. Apply them in one batch after you approve

## Available Tools

Claude has access to these tools:

- `add_bookmarks` — add new links to your hubs
- `list_unsorted` — see what needs sorting
- `list_hubs` — see your existing categories
- `assign_hubs` — assign links to one or more hubs
