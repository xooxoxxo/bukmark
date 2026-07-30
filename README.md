# bookmarkt

A self-hosted bookmark manager built around triage rather than storage. Capture
a page in one click, and everything lands **unsorted** on purpose — sorting is a
separate, deliberate pass you run later by asking Claude, not a decision you make
at 1am with sixty tabs open.

- **Web UI** — virtualized list and grid over tens of thousands of links, full-text
  search, hubs (categories), bulk actions.
- **Browser extension** — Chrome/Brave. Toolbar popup, a keyboard shortcut for
  silent saves, and one-shot import of your existing browser bookmarks.
- **MCP server** — lets Claude read your unsorted pile and file it, with your
  approval, from any Claude session.
- **CLI** — batch-triage OneTab/Chrome/Safari exports into ranked markdown.

## Requirements

- Docker and Docker Compose
- Node.js >= 22 and pnpm 10 (only for the extension build and the CLI)

## Quickstart

```bash
git clone <repo-url> bookmarkt && cd bookmarkt
cp .env.example .env          # optional — defaults work as-is
docker compose up -d
curl localhost:3000/healthz   # {"ok":true}
```

That builds the server image, starts Postgres, applies migrations on boot, and
serves the API and web UI on <http://localhost:3000>.

> **Ports taken?** If port 5432 or 3000 is already in use, set `POSTGRES_PORT` and/or `PORT`
> to free ports in `.env` before running `docker compose up`.

> **The API has no authentication.** None, on any route. It is built to run on a
> trusted network — your LAN, or a Tailscale tailnet — and it must not be exposed
> to the internet. There is no login to add; anyone who can reach the port has
> full read and write access to your bookmarks.

## Browser extension

```bash
pnpm install
pnpm --filter @bookmarkt/extension build   # → apps/extension/dist
```

Then in Chrome or Brave: open `chrome://extensions` (or `brave://extensions`),
turn on **Developer mode**, choose **Load unpacked**, and select
`apps/extension/dist`.

The extension talks to `http://localhost:3000` by default. Running the server
elsewhere? Open the extension's options page and set the URL — your browser will
ask permission for that address the first time you save it.

**If the server runs on a different host from the browser**, add the extension's
origin to `CORS_ORIGINS` in `.env` and restart, or every request fails at the
CORS preflight:

```bash
# Copy the ID from chrome://extensions
CORS_ORIGINS=chrome-extension://your-extension-id-here
```

Then:

- **Toolbar button** — save the current tab with an optional note on why it's
  worth keeping. Re-saving a page you already have tells you so.
- **`Cmd+Shift+S`** / **`Ctrl+Shift+S`** — save silently, no popup, no note.
- **Options → Import all bookmarks** — one-shot import of your browser's
  bookmarks. Everything arrives unsorted; the folder each came from is kept as a
  *hint* for sorting later, never applied automatically. Safe to re-run: existing
  links aren't duplicated and anything you deleted here stays deleted.

## Sorting with Claude (MCP)

```bash
cp .mcp.json.example .mcp.json     # edit BOOKMARKT_API_URL if not localhost:3000
```

Restart Claude Code so it picks the config up, then ask it to *"sort my unsorted
bookmarkt links"*. It lists what's unsorted along with your existing hubs,
proposes assignments, and applies them in one batch after you approve. Tools:
`add_bookmarks`, `list_unsorted`, `list_hubs`, `assign_hubs`.

## CLI (batch triage of exports)

For bulk-importing a tab dump and having Claude triage it in batches:

```bash
pnpm cli ingest path/to/onetab-export.txt   # parse, normalize, dedupe, junk-filter
pnpm cli prepare                            # → work/batch-N.json
# a Claude session writes work/batch-N.result.json
pnpm cli merge-triage
pnpm cli render                             # → output/INDEX.md + per-category + junk report
pnpm cli status
```

Re-ingesting the same file is a no-op. To rescue a junked link, add its URL or a
`prefix*` to `data/allow.txt` and re-run `ingest --force`.

Result schema Claude writes:

```json
{ "batch": 1, "results": [ { "urlHash": "…", "category": "homelab", "keep": true,
  "relevance": 4, "explanation": "≤120 chars", "reason": "only when keep=false" } ] }
```

Relevance: 5 act now · 4 useful reference · 3 maybe · 2 stale · 1 near-junk.

## Development

```bash
docker compose up -d db          # Postgres only
cd apps/server && pnpm dev       # API on :3000, hot reload
cd apps/web && pnpm dev          # Vite dev server, proxies /api
pnpm test                        # full suite
pnpm typecheck
```

Monorepo layout: `apps/server` (Fastify + Drizzle), `apps/web` (React 19 + Vite),
`apps/extension` (MV3, vanilla TS), `apps/mcp` (stdio MCP server), `apps/cli`,
`packages/shared`.

Note: `apps/server` serves `apps/web/dist` statically, and asset routes are
registered at boot — after `pnpm --filter @bookmarkt/web build`, restart the
server or new bundles fall through to the SPA fallback.

## A note on fetching preview images

Adding a bookmark fetches its `og:image` server-side. That fetcher blocks
private, loopback, link-local (including the cloud metadata endpoint
`169.254.169.254`) and CGNAT ranges, follows redirects manually and re-validates
every hop, and caps both time and body size — so a submitted URL can't be used to
reach services inside your network.

## License

MIT — see [LICENSE](LICENSE).
