---
title: Import & Export
description: Bring bookmarks in from your browser, and get bukmark data out as HTML, JSON, or CSV.
sidebar:
  order: 5
---

Bring your existing bookmarks in, and get your data back out — as a file a
browser will import, a backup, or a spreadsheet.

## Import

**Settings → Import bookmarks…** in the sidebar takes a bookmarks HTML file
exported from Chrome, Firefox or Safari, or a JSON backup from bukmark itself.

Everything you import lands **unsorted**, on purpose. The browser folder a link
came from is kept as a hint on the capture rather than turned into a hub, so
your existing hubs stay as you left them and the sort stays a decision you make
— see [Sorting with MCP](/docs/sorting/), which reads those hints.

What import does with links you already have:

| Situation | What happens |
| -- | -- |
| Link is already in bukmark | Left alone. An empty title gets filled in; a title you have edited is never overwritten. |
| Link was deleted here | Stays deleted. Re-importing a browser tree does not undo your deletions. |
| Same link in two folders | Imported once. |
| Bookmarklet, `place:` query, feed | Skipped — only `http` and `https` links are imported. |

The result line reports each of those counts, so a run that skipped things says
so rather than quietly dropping them.

:::caution[A JSON backup restores links, not hub membership]
Because import creates no hubs, restoring a backup brings your links back
unsorted, carrying their old hub names as a hint. Notes are not restored
either. A backup is a safety net for the links themselves, not yet a
full-fidelity snapshot.
:::

## Export

## Export Examples

The export endpoint needs an access token: create one in the web app under
**Settings → Access tokens** and set `BUKMARK_TOKEN` to it. `-f` makes curl
fail when the server refuses the request, instead of saving the error response
as your backup and exiting as if nothing went wrong.

```bash
# everything, as a restorable backup (includes archived links)
curl -fOJ -H "Authorization: Bearer $BUKMARK_TOKEN" 'http://localhost:3000/api/export?format=json&status=all'

# one collection, importable by Chrome, Firefox or Safari
curl -fOJ -H "Authorization: Bearer $BUKMARK_TOKEN" 'http://localhost:3000/api/export?format=html&hub=<hub-id>'

# whatever matches a search, as a spreadsheet
curl -fOJ -H "Authorization: Bearer $BUKMARK_TOKEN" 'http://localhost:3000/api/export?format=csv&q=rust'
```

Or use the **Export** button in the web UI header, which exports exactly what
you are currently looking at, plus a *Full backup* entry that ignores your
filters.

## Format Comparison

| Format | Use it for |
| -- | -- |
| `html` | Importing into Chrome, Firefox or Safari. Everything lands in one **bukmark** folder, as with [bookmark sync](/docs/extension/#sync-with-your-bookmarks): a folder per hub, and **Unsorted** for links in no hub (a hub called Unsorted gets **Unsorted (hub)**). Notes become descriptions. A link in several hubs appears in each. |
| `json` | Backups. Versioned, carries every field, and references hubs by name rather than id. Note the caution above: importing one restores links, not hub membership. |
| `csv` | Spreadsheets. One row per link, hubs semicolon-separated. |

## Filters

Filters match `GET /api/links` — `q`, `hub`, `unassigned`, `status` — plus
`status=all`, which includes archived links.

**Use `status=all` for a real backup**; the default is `active` only. Without
`status=all`, your export omits archived (deleted) links, so a restore would
re-create them.
