# bukmark

[![ci](https://github.com/xooxoxxo/bukmark/actions/workflows/ci.yml/badge.svg)](https://github.com/xooxoxxo/bukmark/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/xooxoxxo/bukmark)](https://github.com/xooxoxxo/bukmark/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-fd441d)](LICENSE)

**Bookmarks you own.** A self-hosted bookmark manager built around triage.
Save any page in one click; everything lands **unsorted** on purpose. Sorting is
a separate pass you run when you choose, by hand or by asking your AI assistant.

[Website](https://bukmark.it) · [Docs](https://bukmark.it/docs/) ·
[Install](https://bukmark.it/docs/install/) · [Releases](https://github.com/xooxoxxo/bukmark/releases)

[![bukmark: bookmarks you own](https://bukmark.it/og/home.png)](https://bukmark.it)

## What it does

- **Save in one click.** A browser extension for Chrome, Edge, Brave, Opera,
  Firefox and Safari: the toolbar button saves the page with an optional note,
  a keyboard shortcut saves silently, and it tells you when a page is already
  saved and where. On a phone, share to the web app, or use an iOS Shortcut.
- **Search what you saved.** The server keeps the text of every saved page, so
  search finds words inside pages, not only titles, and you keep a copy when a
  page disappears. Broken links are flagged.
- **Sort when you choose.** Hubs group links. Connect the MCP server and your
  assistant proposes hubs for your unsorted links; you approve them in one batch.
- **Keep your browser in step.** Import your browser's bookmarks once, or sync a
  `bukmark` folder both ways.
- **Leave any time.** Export HTML for any browser, JSON or CSV: everything, one
  hub, or a search.

One Docker Compose stack: the server (API and web app) and Postgres. No
accounts, no telemetry; one password protects it.

## Install

You need Docker with Compose v2, running. On macOS: Docker Desktop, OrbStack or
Colima.

**Install script.** Puts the `bukmark` command in `~/.local/bin` and sets it
up, without sudo.

```bash
curl -fsSL https://bukmark.it/install.sh | sh
```

**Homebrew.**

```bash
brew install xooxoxxo/tap/bukmark
bukmark setup
```

> The script and Homebrew run the published image, which arrives with the first
> release (v0.3.0). Until then, use Docker Compose from source.

**Docker Compose from source.**

```bash
git clone https://github.com/xooxoxxo/bukmark.git bukmark && cd bukmark
docker compose up -d
curl localhost:3000/healthz   # {"ok":true}
```

Then open <http://localhost:3000> and set your password right away: until it is
set, whoever reaches the port first can set it. Port 3000 or 5432 taken? Copy
`.env.example` to `.env` and change `PORT` or `POSTGRES_PORT`. The
[install guide](https://bukmark.it/docs/install/) covers the `bukmark` command,
settings, HTTPS, reverse proxies and updating.

### The browser extension

Not in the browser stores yet. Build it with Node.js 22+ and pnpm 10, then load
it: `pnpm install && pnpm --filter @bukmark/extension build`, and follow the
[extension guide](https://bukmark.it/docs/extension/) for Chrome, Firefox and
Safari.

## Documentation

[bukmark.it/docs](https://bukmark.it/docs/): [install](https://bukmark.it/docs/install/),
[browser extension](https://bukmark.it/docs/extension/),
[capture from your phone](https://bukmark.it/docs/phone/),
[sorting with MCP](https://bukmark.it/docs/sorting/),
[import and export](https://bukmark.it/docs/export/),
[API](https://bukmark.it/docs/api/), [privacy](https://bukmark.it/docs/privacy/).

## Contributing

Bug reports and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
Security problems: report them privately, as [SECURITY.md](SECURITY.md) says.

## License

[MIT](LICENSE).
