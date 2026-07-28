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

Note: adding a bookmark fetches its og:image server-side. The fetcher blocks private, loopback, link-local (incl. cloud-metadata `169.254.169.254`), and CGNAT/tailnet address ranges, follows redirects manually and re-validates every hop, and caps time and body size — so a supplied URL can't be used to reach internal services (SSRF). Still keep the API on a trusted network (LAN/tailnet); it has no auth.

## Extension (capture + Claude sorting)

Chrome/Brave extension (`apps/extension`) for capturing the current tab and importing browser bookmarks.

```bash
pnpm --filter @bookmarkt/extension build    # → apps/extension/dist
# Load dist/ unpacked: brave://extensions, Developer mode on
# Set server URL in extension options (defaults to http://localhost:3000)
# Import bookmarks (one-shot in options page)

# Then sort unsorted bookmarks via Claude:
# → list_unsorted, list_hubs, assign_hubs tools in MCP
```

Toolbar popup saves current tab; keyboard shortcut `Cmd+Shift+S` (Mac) / `Ctrl+Shift+S` (others) saves silently. Browser bookmarks imported with folder structure preserved as hints. See docs/superpowers/HANDOVER.md for CORS setup and host_permissions pinning.
