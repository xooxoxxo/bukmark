# bukmark

A self-hosted bookmark manager built around triage rather than storage. Capture
a page in one click, and everything lands **unsorted** on purpose — sorting is a
separate, deliberate pass you run later by asking your AI assistant, not a decision you make
at 1am with sixty tabs open.

- **Web UI** — virtualized list and grid over tens of thousands of links, full-text
  search, hubs (categories), bulk actions.
- **Browser extension** — Chrome, Edge, Brave, Opera, Firefox and Safari. Toolbar
  popup, a keyboard shortcut for silent saves, and one-shot import of your
  existing browser bookmarks.
- **Phone capture** — install the web app to save from Android's Share sheet, or
  use an iOS Shortcut or a bookmarklet. Installing the web app needs HTTPS.
- **MCP server** — lets any MCP client read your unsorted pile and file it, with your
  approval, from any MCP-compatible tool or session.
- **CLI** — batch-triage OneTab/Chrome/Safari exports into ranked markdown.

## Requirements

- Docker with Compose v2, running. On macOS: Docker Desktop, OrbStack or Colima.
- Node.js >= 22 and pnpm 10 (only to build the extension and for the v0 triage CLI)

## Install

Pick one. The first two install the `bukmark` command, which runs the published
image; the third builds the image from source.

**Install script.** Puts `bukmark` in `~/.local/bin` and sets it up. It
installs into your home folder only and never uses sudo.

```bash
curl -fsSL https://bukmark.it/install.sh | sh
```

**Homebrew.**

```bash
brew install xooxoxxo/tap/bukmark
bukmark setup
```

**Docker Compose from source.**

```bash
git clone https://github.com/xooxoxxo/bukmark.git bukmark && cd bukmark
cp .env.example .env          # optional — defaults work as-is
docker compose up -d
curl localhost:3000/healthz   # {"ok":true}
```

That builds the server image, starts Postgres, applies migrations on boot, and
serves the API and web UI on <http://localhost:3000>.

> **Ports taken?** If port 5432 or 3000 is already in use, set `POSTGRES_PORT` and/or `PORT`
> to free ports in `.env` before running `docker compose up`.

Whichever you pick, open <http://localhost:3000> (or the port you chose) and set
your password straight away. `bukmark help` lists the command's other commands: `status`, `update`,
`stop`, `uninstall` and more. The [install guide](https://bukmark.it/docs/install/)
has the details.

## Documentation

For setup instructions, browser extension guide, sorting, export options, CLI usage, development guide, and API documentation, see <https://bukmark.it>.

## License

MIT — see [LICENSE](LICENSE).
