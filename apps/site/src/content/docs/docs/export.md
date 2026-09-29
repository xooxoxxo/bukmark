---
title: Import & Export
description: Bring bookmarks in from your browser, and get bukmark data out as HTML, JSON, or CSV.
sidebar:
  order: 5
---

Bring your existing bookmarks in, and get your data back out as a file a browser
will import, a backup, or a spreadsheet. At the end you have imported a bookmarks
file, or saved an export from the web app or with `curl`.

## Import

1. Get a bookmarks file: HTML exported from a browser (Chrome, Edge, Firefox,
   Safari), a CSV export from Raindrop, Pocket or Instapaper, or a JSON backup
   from bukmark itself.
2. In the web app's sidebar, open **Settings → Import bookmarks…** and choose
   the file.
3. Read the result line. It counts each case [below](#duplicates-and-skips), so
   a run that skipped things says so rather than quietly dropping them.
4. Sort: everything you import lands **unsorted**, on purpose
   ([Sorting with MCP](/docs/sorting/)).

### CSV files

Any CSV with a header row and a `url` column imports: Raindrop, Pocket and
Instapaper exports, or a spreadsheet you made. Headers are matched regardless of
case.

| Column | Read as |
| -- | -- |
| `url`, `link`, `href` or `address` | The link. Required. |
| `title` or `name` | Its title. |
| `folder`, `collection` or `category` | A hint for sorting, like a browser folder. |
| `tags`, `labels` or `keywords` | Added to that hint. |

Other columns, notes and excerpts included, are not imported.

### Duplicates and skips

| Situation | What happens | Result line |
| -- | -- | -- |
| Link is already in bukmark | Left alone. An empty title gets filled in; a title you have edited is never overwritten. | already here |
| Link was deleted here | Stays deleted. Re-importing a browser tree does not undo your deletions. | stayed deleted |
| Same link in two folders | Imported once. | duplicate |
| Bookmarklet, `place:` query, feed | Skipped: only `http` and `https` links are imported. | not web links |

:::caution[A JSON backup restores links, not hub membership]
Because import creates no hubs, restoring a backup brings your links back
unsorted, carrying their old hub names as a hint. Notes are not restored
either. A backup is a safety net for the links themselves, not yet a
full-fidelity snapshot.
:::

<details>
<summary>Why browser folders don't become hubs</summary>

The browser folder a link came from is kept as a hint on the capture rather than
turned into a hub, so your existing hubs stay as you left them and the sort stays
a decision you make. The MCP server reads those hints.

</details>

## Export

### From the web app

Everything at once: open **Settings** in the sidebar. It has **Export HTML**,
**Export JSON** and **Export CSV** for every active link, and **Full backup**:
JSON, archived links included.

One hub or a search:

1. Open the view you want: the export takes exactly what you are looking at.
2. Open the **•••** menu next to the view's title and choose a format:
   **Export HTML**, **Export JSON**, **Export CSV**.
3. For a backup, choose **Full backup (JSON)** instead: it ignores your filters
   and includes archived links.

### Export examples

1. Create an access token under **Settings → Access tokens** and set
   `BUKMARK_TOKEN` to it.
2. Run the command you need. `-f` makes curl fail when the server refuses the
   request, instead of saving the error response as your backup and exiting as
   if nothing went wrong.

   ```bash
   # everything, as a restorable backup (includes archived links)
   curl -fOJ -H "Authorization: Bearer $BUKMARK_TOKEN" 'http://localhost:3000/api/export?format=json&status=all'

   # one collection, importable by Chrome, Firefox or Safari
   curl -fOJ -H "Authorization: Bearer $BUKMARK_TOKEN" 'http://localhost:3000/api/export?format=html&hub=<hub-id>'

   # whatever matches a search, as a spreadsheet
   curl -fOJ -H "Authorization: Bearer $BUKMARK_TOKEN" 'http://localhost:3000/api/export?format=csv&q=rust'
   ```

## Format Comparison

| Format | Use it for |
| -- | -- |
| `html` | Importing into Chrome, Firefox or Safari. Everything lands in one **bukmark** folder, as with [bookmark sync](/docs/extension/#sync-with-your-bookmarks): a folder per hub, and **Unsorted** for links in no hub (a hub called Unsorted gets **Unsorted (hub)**). Notes become descriptions. A link in several hubs appears in each. |
| `json` | Backups. Versioned, carries every field, and references hubs by name rather than id. Restoring one brings back links, not hub membership (see [Import](#import)). |
| `csv` | Spreadsheets. One row per link, hubs semicolon-separated. |

## Filters

**Use `status=all` for a real backup**; the default is `active` only. Without
`status=all`, your export omits archived (deleted) links, so a restore would
re-create them.

Filters match `GET /api/links` (`q`, `hub`, `unassigned`, `broken`, `status`),
plus `status=all`, which includes archived links. The
[API reference](/docs/api/#get-apiexport) describes each.
