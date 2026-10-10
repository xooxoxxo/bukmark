---
title: Privacy
description: What the browser extension sends and when, what your own server keeps, and what this website loads.
sidebar:
  order: 10
---

bukmark is software you run yourself, with no company server and no account.

Effective 29 September 2026.

Your data goes only to the bukmark server you run. Whoever runs it, usually
you, is in charge of that data. The people who make bukmark receive none of it.

## The browser extension

bukmark capture sends data only to the server address under **Server**
(`http://localhost:3000` unless you change it). It has no analytics, telemetry,
ads or tracking, and it contacts no other address. Browsers may describe this
at install as data the developer collects; it goes only to your server.

### What it sends, and when

Logged out, it sends nothing until you click **Log in** or **Use token**.

#### Saving a page

- **Opening the popup** on a web page sends that page's address to your server
  (`GET /api/links/lookup`) to show whether it is saved, and asks for your hubs.
- **Save** in the popup sends the page's address and title, and your note and
  hub if you filled them in.
- **`Alt+Shift+K`** (`Control+Shift+K` on a Mac) sends the page's address and
  title.

Only `http://` and `https://` pages are ever sent.

#### Saving a quote

**Save quote to bukmark** (right-click menu or shortcut) sends the selected
text with the page's address and title (`POST /api/quotes`) to your server,
which saves the page too if needed. Nothing is sent when nothing is selected.

#### Your bookmarks

The extension has no access to your bookmarks until you click Import or turn on
sync. The browser asks you then (Firefox also asks whether it may share them
with your server).

**Import all bookmarks** sends every bookmark whose
address starts with `http://` or `https://`: its address, title and folder.
It then asks your server to look up preview images for them.

**Sync with your browser's bookmarks**, while on, sends what you change in the
**bukmark** folder as you change it:

| When you | It sends |
| -- | -- |
| Add, rename or move a bookmark | The bookmark's address, title and folder |
| Delete a bookmark | Which link to archive |
| Add, rename or delete a folder | The folder's name |
| Turn sync on | The bookmarks already in the folder that your server lacks |

Every 5 minutes, when the browser starts and after a save, it asks your server
what changed (`GET /api/links/changes`) and updates the folder. Only
`http://` and `https://` bookmarks are sent. In Firefox, taking back the
permission to share bookmarks, in `about:addons`, turns sync off.

Import reads all your bookmarks. Sync reads and changes only the bukmark
folder, and sends nothing about bookmarks outside it; it looks outside only to
find the folder and to check whether a changed bookmark is in it. Bookmarks are
read at no other time.

#### Logging in and out

- **Log in** opens your server's login page. You type your password there,
  never into the extension, which then trades a one-time code for a token.
- **Use an access token instead** sends the pasted token to your server.
- **Log out**, changing the server address, or a new login asks your server to
  revoke the old token.

The token goes only to the server that issued it. For a server not on your own
computer, use `https://`: over `http://`, everything, the token included, is
sent unencrypted. See [HTTPS](/docs/install/#https).

### What it keeps in your browser

- The server address, in `storage.sync` (it follows you through browser sync),
  or `storage.local` where there is no sync storage.
- The access token, in `storage.local`. Log out deletes it.
- With bookmark sync on, the address and title of each link in the bukmark
  folder and which bookmarks hold it, in `storage.local`, with changes waiting
  to be sent. Turning sync off drops the waiting changes and keeps the list.
- Short-lived state, such as a login in progress, the last error and
  the folder changes a sync is making, in `storage.session`, emptied when the
  browser closes.

Apart from sync's list, it keeps no history.

### What it never does

It has no content scripts: it never reads, changes or runs code in the pages you
visit. The one exception is saving a quote: it runs one line in that tab to read
the selected text and which frame has the focus. It sees the current tab's
address and title only when you open the popup, press a shortcut or choose the
quote item (`activeTab`).

In Chrome, Edge and Firefox it has no `tabs` permission and sees no other tab's
address, except a login tab on your server. Safari's build has `tabs` to follow
its logins. It keeps and sends nothing about any other tab.

### Permissions

| Permission | What it is for |
| -- | -- |
| `activeTab` | The address and title of the tab you are on, when you open the popup, press a shortcut or save a quote. |
| `contextMenus` | The **Save quote to bukmark** item in the right-click menu of selected text. |
| `scripting` | Reading the text you selected, with its line breaks, in the tab where you save a quote. Only that tab, only then. |
| `alarms` | Asking your server for changes every 5 minutes while bookmark sync is on. |
| `bookmarks` | Optional, and not granted at install. Asked for when you click **Import all bookmarks**, to read them, or turn on sync, to keep the bukmark folder. |
| `tabs` | Safari only: following the tab a login opens, since Safari has no login window. |
| `storage` | Keeping the server address, the token, sync's state and short-lived login state. |
| `identity` | Opening your server's login page in the browser's login window. No Google or other account is involved. |
| `http://localhost/*` | Reaching a server on your own computer, such as the default `http://localhost:3000`. |
| `http://*/*`, `https://*/*` | Optional, and not granted at install. Your browser asks you to allow each server address you enter. Never every site. |

Safari's build has no `bookmarks`, `identity` or `alarms` permission.

### Limited Use

bukmark capture's use of data follows the Chrome Web Store User Data Policy,
including the Limited Use requirements. It uses the data only to save pages to
your server and keep the bukmark folder in sync. It never sells it, uses it for
ads, or passes it to anyone else.

## Your bukmark server

Your server keeps in its Postgres database each link's address, title, note and
hubs, when and how it was saved, the folder an imported bookmark came from, a
preview image address, and the page text below.

Your password, access tokens and sign-in sessions are stored only as hashes. The
first 12 characters of each token are kept too, to tell tokens apart.

### Reading saved pages

When you save a page, the server fetches the top of it once, to find its preview image.

By default it also fetches each saved page in the background, about 20 a
minute, and again every 30 days. It keeps the page's text for search and as a
copy, and marks gone pages as broken. It fetches only public addresses. Sites see
the requests come from your server, which names itself as bukmark.

`BUKMARK_CHECK_PAGES=false` stops the background checks
([Install](/docs/install/#environment-variables)). The server then fetches pages
only when asked: when you save one, for its preview image; after an extension
import, for missing preview images; and when a check or preview lookup is
requested through the [API](/docs/api/#post-apilinkscheck).

### Logs

The server logs each request to its console: the time, the IP address and the
address requested. For the popup's check, that address includes the page's
address. Tokens and cookies are left out. Docker keeps this output like any container's;
bukmark stores it nowhere else.

### The web app

The web app keeps you signed in with one cookie, `bukmark_session`, for 30 days.
It loads its fonts from Google Fonts (`fonts.googleapis.com` and
`fonts.gstatic.com`), and each link's preview image from the saved page's site,
without telling that site which page showed it.

### MCP clients

An [MCP client](/docs/sorting/) you sort with receives what it reads from your
server (addresses, titles, notes, folder hints and hubs), and so does whoever
runs its AI model.

## Deleting your data

- **The extension's login:** click **Log out** on the extension's settings page.
  It deletes the token from your browser and asks your server to revoke it. If
  the server can't be reached, revoke **bukmark capture** under
  **Settings → Access tokens**. Removing the extension deletes everything it
  kept in that browser; the bukmark folder stays as ordinary bookmarks.
- **A link:** in its **Edit** dialog, click **Delete…**, then **Delete**. Its
  title, note, hubs and saved text go with it. The server keeps only a SHA-256
  hash of its address, so a re-import doesn't bring it back, and the link's
  random id with the time it was deleted, so that a browser syncing its
  bookmarks removes it too.
- **Everything:** `bukmark uninstall --delete-data` deletes the database volume,
  with every link, hub, token and session, and the settings in `~/.bukmark`.
  From source, `docker compose down -v` in the checkout deletes the database
  volume.

## This website

bukmark.it is a static site with no accounts and no cookies.

- **Cloudflare Pages** hosts it and, like any web host, receives your IP address
  and the pages you request.
- **Cloudflare Web Analytics** counts visits. Its script, from
  `static.cloudflareinsights.com`, sets no cookies and stores nothing in your
  browser; it reports the page, the referring site, your browser and your
  country, not who you are. It runs only on this website, never in the bukmark
  app or the extension.

Its fonts come from bukmark.it too, so no font service sees your visit.

The docs remember whether you chose the light or dark theme in your browser's
local storage. That choice is not sent anywhere.

## Changes and contact

If what the extension sends changes, this page will say so before that version
is released, with a new date at the top. Its history is in the
[repository](https://github.com/xooxoxxo/bukmark).

Questions: open a public issue at
[github.com/xooxoxxo/bukmark/issues](https://github.com/xooxoxxo/bukmark/issues).
Leave out anything private.
