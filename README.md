# bukmark

A self-hosted bookmark manager built around triage rather than storage. Capture
a page in one click, and everything lands **unsorted** on purpose — sorting is a
separate, deliberate pass you run later by asking your AI assistant, not a decision you make
at 1am with sixty tabs open.

- **Web UI** — virtualized list and grid over tens of thousands of links, full-text
  search, hubs (categories), bulk actions.
- **Browser extension** — Chrome/Brave. Toolbar popup, a keyboard shortcut for
  silent saves, and one-shot import of your existing browser bookmarks.
- **MCP server** — lets any MCP client read your unsorted pile and file it, with your
  approval, from any MCP-compatible tool or session.
- **CLI** — batch-triage OneTab/Chrome/Safari exports into ranked markdown.

## Requirements

- Docker and Docker Compose
- Node.js >= 22 and pnpm 10 (only for the extension build and the CLI)

## Quickstart

```bash
git clone <repo-url> bukmark && cd bukmark
cp .env.example .env          # optional — defaults work as-is
docker compose up -d
curl localhost:3000/healthz   # {"ok":true}
```

That builds the server image, starts Postgres, applies migrations on boot, and
serves the API and web UI on <http://localhost:3000>. Open the URL and set an
owner password on first run.

> **Ports taken?** If port 5432 or 3000 is already in use, set `POSTGRES_PORT` and/or `PORT`
> to free ports in `.env` before running `docker compose up`.

## Documentation

For setup instructions, browser extension guide, sorting, export options, CLI usage, development guide, and API documentation, see <https://bukmark.it>.

## License

MIT — see [LICENSE](LICENSE).
