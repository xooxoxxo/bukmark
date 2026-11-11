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

### Browser session archives

The `bukmark sessions` command reads the JSONL archives created by `sessions capture`. Run
`sessions inspect` to see numbered snapshots and groups, tab counts, and the
number of unique bookmark candidates. Inspection reads the files locally.

```sh
bukmark sessions inspect SafariTabGroups.jsonl ChromeSessions.jsonl
```

Session commands run locally with Node.js 22.13 or newer. On first use, the
installed command downloads its versioned helper and verifies its checksum.
This downloads code only; archives stay on this machine. Android capture and
cleanup also need Android Platform Tools (`adb`) on this machine.

With one phone connected over USB and its regular Chrome tab switcher visible,
capture the tab metadata locally. Confirm that Chrome has zero Incognito tabs
before running the command. You can also pass a previously captured local USB
probe with `--probe`.

```sh
bukmark sessions capture android \
  --out AndroidChromeUSB.jsonl --confirm-no-incognito
```

Android USB captures are partial. Group membership, switcher order, and
coverage of inactive tabs are unknown.

Use the same file order when choosing a numbered snapshot or group. Repeat
`--select` to choose more than one, or use `--all` for the full set. Set
`BUKMARK_TOKEN` to an access token for your instance, then choose an explicit
destination and mode.

```sh
bukmark sessions import SafariTabGroups.jsonl \
  --select 1 --destination http://localhost:3000 --preview
```

Preview sends the selection to that instance to check for existing and deleted
bookmarks. Use `--apply` to save it. After an interrupted import, run the same
selection again to finish it. Several tab occurrences can share one bookmark
and keep separate source details. Links that were already saved keep their
existing settings.

Use `sessions verify` with the same selection and destination to read back
saved occurrences and write a private receipt of exact matches.

```sh
bukmark sessions verify AndroidChromeUSB.jsonl \
  --all --destination http://localhost:3000 --receipt AndroidChromeUSB.receipt.json
```

Android cleanup is an explicit command. It
requires a direct USB archive with a handset fingerprint and a destination
that supports session verification. Archives converted with `--probe` do
not contain a handset fingerprint and cannot be used for cleanup.

```sh
bukmark sessions close android AndroidChromeUSB.jsonl \
  --destination http://localhost:3000 --preview --confirm-no-incognito
```

Cleanup matches current Android tab IDs and exact URLs to saved occurrences
read back from bukmark. It preserves loaded tabs and any tabs sharing their
URLs, and excludes changed or unverified tabs. The implementation accepts
`--apply --log AndroidChromeUSB.closed.jsonl` in place of `--preview`, records
each close request before sending it, and checks the remaining tab list after
each request and at completion. Keep the log for retries.

Keep Chrome’s regular switcher visible and leave the phone untouched during
cleanup. Concurrent manual changes stop the command. Loaded tabs remain open
because closing them could select and load another page. Inactive-tab
coverage and group order remain unknown.

Closing is currently enabled only for the validated Android Chrome build
157.0.8103.48. Other builds can capture metadata and preview matches, but apply
stops until their close behavior has been validated.

New session bookmarks stay out of automatic page checks, preview fetching, and
browser bookmark sync. To enable these for a link, send
`{"sessionProtected":false}` to `PATCH /api/links/:id`.

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
