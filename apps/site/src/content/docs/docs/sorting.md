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

## Saved sifting previews

Open **Review** and choose **Sifting previews** from **Review area** to save local suggestions and reopen earlier runs.
Choose a reviewed batch, the selected bookmark, or the next 100 bookmarks without a recorded bin.
The preview shows suggestions beside recorded bin choices, approval evidence and existing export receipts.

Saving the same inputs again reuses the run and its results. Changes to source data or review evidence create a comparison with the earlier run.
Owner choices remain recorded when a new suggestion differs. A changed membership is shown as a hold rather than a replacement decision.

This flow uses stored data and local URL rules. It does not read saved websites or call a model.
Protected sources are analyzed on the server; preview responses expose only their aggregate count.
That check also applies when opening a run saved before a source became protected.

Recording a preview does not move bookmarks, change their reviews, prepare handoffs or create exports.
Open **Review changes to bins** to inspect a selection. Applying it requires an owner browser session and a server with bin changes enabled.

## Troubleshooting

If every tool call fails with "bukmark rejected the request (401)", set
`BUKMARK_API_TOKEN` to a token from **Settings → Access tokens** and restart
your client.
