# bookmarkt

Tab-dump triage pipeline. Ingest OneTab exports, dedupe, junk-filter,
Claude-triage, render ranked markdown.

## Loop (per file drop)

    pnpm cli ingest path/to/onetab-export.txt
    pnpm cli prepare            # writes work/batch-N.json
    # → Claude session triages batches → work/batch-N.result.json
    pnpm cli merge-triage
    pnpm cli render             # output/INDEX.md + per-category + junk report
    pnpm cli status

Re-ingesting the same file is a no-op. New files merge; re-render anytime.

## Salvage a junked link

Add exact URL or `prefix*` to `data/allow.txt`, re-run ingest with `--force`.

## Result file schema (what Claude writes)

    { "batch": 1, "results": [ { "urlHash": "…", "category": "homelab",
      "keep": true, "relevance": 4, "explanation": "≤120 chars", "reason": "only when keep=false" } ] }

Relevance: 5 act now · 4 useful reference · 3 maybe · 2 stale · 1 near-junk.

## Platform (TabHub server)

    docker compose up -d db
    cd apps/server
    pnpm db:migrate        # apply schema
    pnpm db:import ../../data/store.json   # bridge v0 triage into Postgres
    pnpm dev               # API on :3000

API: GET /api/links?q=&hub=&unassigned=&status=, PATCH /api/links/:id,
POST /api/links/bulk, CRUD /api/hubs, GET /api/stats. Web UI: next plan.

## Add bookmarks from Claude (MCP)

The repo ships an MCP server (`apps/mcp`) registered in `.mcp.json`. With the API server running (`cd apps/server && pnpm dev`, on :3000) and Claude Code restarted so it loads `.mcp.json`, Claude can call the `add_bookmarks` tool.

Input: `{ items: [{ url, title?, note?, hub?, relevance? }] }` — url required; hub is a category name (auto-created); relevance is 1–5. Existing urls are updated in place; previously deleted urls are resurrected.

Set `BOOKMARKT_API_URL` in `.mcp.json` env if the server isn't at `http://localhost:3000` (e.g. tailnet address).

Note: adding a bookmark fetches its og:image server-side and follows HTTP redirects, so a supplied URL can reach hosts on the server's network. Run bookmarkt only on trusted networks (LAN/tailnet), not exposed to untrusted callers.
