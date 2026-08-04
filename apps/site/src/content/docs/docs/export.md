---
title: Export
description: Export bukmark data as HTML, JSON, or CSV for backups and other uses.
sidebar:
  order: 4
---

Get your data out — as a file a browser will import, a backup you can restore,
or a spreadsheet.

## Export Examples

```bash
# everything, as a restorable backup (includes archived links)
curl -OJ 'http://localhost:3000/api/export?format=json&status=all'

# one collection, importable by Chrome, Firefox or Safari
curl -OJ 'http://localhost:3000/api/export?format=html&hub=<hub-id>'

# whatever matches a search, as a spreadsheet
curl -OJ 'http://localhost:3000/api/export?format=csv&q=rust'
```

Or use the **Export** button in the web UI header, which exports exactly what
you are currently looking at, plus a *Full backup* entry that ignores your
filters.

## Format Comparison

| Format | Use it for |
| -- | -- |
| `html` | Importing into Chrome, Firefox or Safari. Hubs become folders; notes become descriptions. A link in several hubs appears in each. |
| `json` | Backups. Versioned, carries every field, and references hubs by name so it restores into a fresh database. |
| `csv` | Spreadsheets. One row per link, hubs semicolon-separated. |

## Filters

Filters match `GET /api/links` — `q`, `hub`, `unassigned`, `status` — plus
`status=all`, which includes archived links.

**Use `status=all` for a real backup**; the default is `active` only. Without
`status=all`, your export omits archived (deleted) links, so a restore would
re-create them.
