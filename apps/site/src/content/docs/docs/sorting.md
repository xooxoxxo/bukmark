---
title: Sorting with MCP
description: Use any MCP client and the bukmark MCP server to sort your unsorted bookmarks into hubs.
sidebar:
  order: 5
---

The bukmark MCP server lets any MCP client (Claude Code, Cursor, Zed or another)
read your unsorted bookmarks and file them into hubs, with your approval.

## Setup

1. In the web app, open **Settings → Access tokens**, enter a name under
   *New token* (e.g. "Claude Code") and click **Create token**, then **Copy**.
   The token is shown only once.
2. In Claude Code, copy `.mcp.json.example` to `.mcp.json` at the repo root and
   fill in your token. For another client, see
   [Other MCP clients](#other-mcp-clients).

   ```bash
   cp .mcp.json.example .mcp.json
   ```

3. Restart your MCP client.

## Using it

1. Ask your MCP client to *"sort my unsorted bukmark links"*.
2. Review the hubs it proposes for each link.
3. Approve. It applies them in one batch.

## Configuration

The MCP server runs `pnpm exec tsx apps/mcp/src/index.ts` with
`BUKMARK_API_URL` and `BUKMARK_API_TOKEN` set. For Claude Code, in `.mcp.json`
at the repo root:

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

Put the same command, args and environment variables in your client's MCP
config. See [modelcontextprotocol.io](https://modelcontextprotocol.io).

## Available tools

| Tool | What your client can do with it |
| -- | -- |
| `add_bookmarks` | Add new links to your hubs. |
| `list_unsorted` | See what needs sorting, with the browser folder an imported link came from. |
| `list_hubs` | See your existing hubs. |
| `assign_hubs` | Assign links to one or more hubs. |

## Troubleshooting

If every tool call fails with "bukmark rejected the request (401)", set
`BUKMARK_API_TOKEN` to a token from **Settings → Access tokens** and restart
your client.
