---
title: Import & Export
description: Bring bookmarks in from your browser, and get bukmark data out as HTML, JSON, or CSV.
sidebar:
  order: 6
---

Import bookmarks from a file, and export your data as HTML, JSON or CSV.

## Import

1. Get a bookmarks file: HTML exported from a browser (Chrome, Edge, Firefox,
   Safari), a CSV export from Raindrop, Pocket or Instapaper, an
   [Omnivore export](#omnivore-exports) (the ZIP, or one of its
   `metadata_*.json` files), or a JSON backup from bukmark.
2. In the web app's sidebar, open **Settings → Import bookmarks…** and choose
   the file.
3. Read the result line. It counts what was skipped and why
   ([below](#duplicates-and-skips)).

Everything you import lands **unsorted**. A browser folder is kept as a hint for
[sorting](/docs/sorting/), not turned into a hub.

### CSV files

Any CSV with a header row and a `url` column works (any case).

| Column | Read as |
| -- | -- |
| `url`, `link`, `href` or `address` | The link. Required. |
| `title` or `name` | Its title. |
| `folder`, `collection` or `category` | A hint for sorting. |
| `tags`, `labels` or `keywords` | Added to that hint. |

Other columns are not imported.

### Omnivore exports

Choose the export ZIP as downloaded. It is read in your browser.

| In the export | Comes over as |
| -- | -- |
| Each saved item's address and title | A link. Non-`http(s)` addresses count as **not web links**. |
| Labels | A hint for sorting. |
| Highlights (`highlights/*.md`) | [Quotes](/docs/quotes/) on that link, with their notes. Counted as **quotes restored**. |
| Archived items | Ordinary links. |

Page copies, descriptions, authors, thumbnails, reading progress, dates,
highlight labels and page notes are not imported.

Over 1 GB? Unzip it, delete the `content` folder and zip the rest, or import a
single `metadata_*.json` file (links and labels, no highlights).

### Duplicates and skips

| Situation | What happens | Result line |
| -- | -- | -- |
| Link is already in bukmark | Left alone. An empty title gets filled in. | already here |
| Link was deleted here | Stays deleted. | stayed deleted |
| Same link in two folders | Imported once. | duplicate |
| Bookmarklet, `place:` query, feed | Skipped. | not web links |

:::caution[A JSON backup restores links and quotes, not hub membership]
Links come back unsorted, with their old hub names as a hint. Notes are not
restored.
:::

### Quotes in a backup

Importing a JSON backup restores each quote to its link with its text, note and
date. Quotes of deleted pages come back with no page. Quotes you already have
are skipped.

## Duplicates

A link is saved once. Saving a page you already have updates that link.
`www`, tracking parameters and `#fragments` are ignored, and these count as the
same page: `http` and `https`, with or without a trailing slash, the mobile site
(`m.`, `mobile.`) and the AMP version. Different query values, such as two
YouTube videos, stay separate.

## Export

### From the web app

- **Everything:** open **Settings** in the sidebar. **Export HTML**,
  **Export JSON** and **Export CSV** export active links; **Full backup** is
  JSON with archived links included.
- **One hub or a search:** open that view, open the **•••** menu next to its
  title and choose a format. **Full backup (JSON)** there ignores filters.

### Export examples

1. Create an access token under **Settings → Access tokens** and set
   `BUKMARK_TOKEN` to it.
2. Run the command you need (`-f` stops curl saving an error as your file):

   ```bash
   # everything, as a restorable backup (includes archived links)
   curl -fOJ -H "Authorization: Bearer $BUKMARK_TOKEN" 'http://localhost:3000/api/export?format=json&status=all'

   # one collection, importable by Chrome, Firefox or Safari
   curl -fOJ -H "Authorization: Bearer $BUKMARK_TOKEN" 'http://localhost:3000/api/export?format=html&hub=<hub-id>'

   # whatever matches a search, as a spreadsheet
   curl -fOJ -H "Authorization: Bearer $BUKMARK_TOKEN" 'http://localhost:3000/api/export?format=csv&q=rust'
   ```

## Format comparison

| Format | Use it for |
| -- | -- |
| `html` | Importing into Chrome, Firefox or Safari. Everything lands in one **bukmark** folder, as with [bookmark sync](/docs/extension/#sync-with-your-bookmarks): a folder per hub, and **Unsorted** for links in no hub (a hub called Unsorted gets **Unsorted (hub)**). Notes become descriptions. |
| `json` | Backups. Carries every field and your quotes. Restores links and quotes, not hub membership. |
| `csv` | Spreadsheets. One row per link, hubs separated by semicolons. |

## Filters

**Use `status=all` for a backup.** The default exports active links only.

Filters match `GET /api/links` (`q`, `hub`, `unassigned`, `broken`, `status`),
plus `status=all`. Quotes of deleted pages are included only in an unfiltered
JSON export. See the [API reference](/docs/api/#get-apiexport).
