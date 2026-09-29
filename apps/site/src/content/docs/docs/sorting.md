---
title: Sorting with MCP
description: Use any MCP client and the bukmark MCP server to sort your unsorted bookmarks into hubs.
sidebar:
  order: 5
---

Bukmark's MCP (Model Context Protocol) server lets any MCP client (Claude Code,
Cursor, Zed or another) read your unsorted bookmarks and file them into your hubs
(categories), with your approval. By the end, your client is connected and has
sorted a first batch.

## Setup

1. Create a token: in the web app, open **Settings → Access tokens**, enter a
   name under *New token* (e.g. "Claude Code") and click **Create token**, then
   **Copy**. Paste it into your MCP client config right away: the page shows it
   only once.
2. In Claude Code, copy `.mcp.json.example` to `.mcp.json` at the repo root and
   fill in your token. For another client, see
   [Other MCP clients](#other-mcp-clients).

   ```bash
   cp .mcp.json.example .mcp.json
   ```

3. Restart your MCP client so it picks up the server.

## Using It

1. Ask your MCP client to *"sort my unsorted bukmark links"*.
2. Review its proposal: it lists what's unsorted along with your existing hubs,
   then proposes assignments for each link.
3. Approve. It applies them in one batch.

## Configuration

The MCP server runs this command:

```bash
pnpm exec tsx apps/mcp/src/index.ts
```

It requires two environment variables:

```bash
BUKMARK_API_URL=http://localhost:3000
BUKMARK_API_TOKEN=<your token>
```

### Claude Code example

The `.mcp.json` file at the repo root is Claude Code's configuration format:

```json
{
  "mcpServers": {
    "bukmark": {
      "command": "pnpm",
      "args": ["exec", "tsx", "apps/mcp/src/index.ts"],
      "env": {
        "BUKMARK_API_URL": "http://localhost:3000",
        "BUKMARK_API_TOKEN": "bkm_..."
      }
    }
  }
}
```

### Other MCP clients

Other clients take the same command, args, and environment variables in their
own configuration format. See your client's MCP documentation; the
[Model Context Protocol docs](https://modelcontextprotocol.io) cover popular
clients.

## Available Tools

| Tool | What your client can do with it |
| -- | -- |
| `add_bookmarks` | Add new links to your hubs. |
| `list_unsorted` | See what needs sorting. For an imported link it also shows the browser folder it came from, as a hint. |
| `list_hubs` | See your existing categories. |
| `assign_hubs` | Assign links to one or more hubs. |

## Troubleshooting

<details>
<summary>Every tool call fails with a 401</summary>

Without a valid token, every tool call fails with "bukmark rejected the request
(401)". Set `BUKMARK_API_TOKEN` to a token from **Settings → Access tokens**
and restart your client.

</details>
