---
title: Sorting with MCP
description: Use any MCP client and the bukmark MCP server to intelligently sort your unsorted bookmarks.
sidebar:
  order: 3
---

Bukmark ships with an MCP (Model Context Protocol) server that lets any MCP client read your unsorted
bookmarks and file them into your hubs (categories), with your approval. Because the server is built on the open MCP standard, it works with any MCP client—whether that's Claude Code, Cursor, Zed, or another tool.

## Setup

The MCP server runs this command:

```bash
pnpm exec tsx apps/mcp/src/index.ts
```

It expects one environment variable:

```bash
BUKMARK_API_URL=http://localhost:3000
```

**Claude Code example:** Copy `.mcp.json.example` to `.mcp.json` and edit the `BUKMARK_API_URL` if needed:

```bash
cp .mcp.json.example .mcp.json
```

The `.mcp.json` file at the repo root is Claude Code's configuration format:

```json
{
  "mcpServers": {
    "bukmark": {
      "command": "pnpm",
      "args": ["exec", "tsx", "apps/mcp/src/index.ts"],
      "env": { "BUKMARK_API_URL": "http://localhost:3000" }
    }
  }
}
```

Other MCP clients take the same command, args, and environment variable in their own configuration format. Refer to your client's MCP documentation for how to set it up—the details differ per tool, but the server command stays the same. If you need help, the [Model Context Protocol docs](https://modelcontextprotocol.io) cover MCP server integration for popular clients.

After configuring your MCP client, restart it so it picks up the server.

## Using It

In your MCP client, ask it to *"sort my unsorted bukmark links"*. It will:

1. List what's unsorted along with your existing hubs
2. Propose assignments for each link
3. Apply them in one batch after you approve

## Available Tools

Your MCP client has access to these tools:

- `add_bookmarks` — add new links to your hubs
- `list_unsorted` — see what needs sorting
- `list_hubs` — see your existing categories
- `assign_hubs` — assign links to one or more hubs
