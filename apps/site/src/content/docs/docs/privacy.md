---
title: Privacy
description: What the browser extension sends and when, what your own server keeps, and what this website loads.
sidebar:
  order: 10
---

bukmark is software you run yourself: there is no bukmark company server and no
bukmark account. This page lists what the browser extension sends and when, what
your own server keeps, and what this website loads.

Effective 29 September 2026.

The browser extension sends your data only to the bukmark server you run, which
keeps it in your own database. Whoever runs that server, usually you, is in
charge of the data on it. The people who make bukmark receive none of it.

## The browser extension

bukmark capture sends data to one place: the server address you enter under
**Server**, which is `http://localhost:3000` unless you change it. It has no
analytics, no telemetry, no ads and no tracking, and it contacts no other address.

Some browsers describe this at install as data the extension's developer
collects. With bukmark capture it goes to your server, and the developers never
see it.

### What it sends, and when

While you are logged out, it sends nothing until you click **Log in** or
**Use token**. Once you are logged in, it sends data at the moments below.

#### Saving a page

- **Opening the popup** on a web page sends that page's address to your server
  (`GET /api/links/lookup`), so the popup can say whether it is already saved.
  It also asks for your list of hubs.
- **Save** in the popup sends the page's address and title, and your note and
  hub if you filled them in.
- **`Alt+Shift+K`** (`Control+Shift+K` on a Mac) sends the page's address and
  title.

Only `http://` and `https://` pages are ever sent: a local file, a browser page
or anything else is not, not even to ask.

#### Saving a quote

**Save quote to bukmark**, in the right-click menu of selected text, or its
shortcut, sends the text you selected with the page's address and title
(`POST /api/quotes`). The text goes to the server you logged in to, and
nowhere else. Your server saves the page too if it isn't saved yet. Nothing is
sent when nothing is selected.

#### Your bookmarks

The extension has no access to your bookmarks until you click Import or turn on
sync: the click asks your browser for it (and, in Firefox, whether it may share
them with your server).

**Import all bookmarks** on the settings page sends every bookmark whose
address starts with `http://` or `https://`: its address, title and folder.
It then asks your server to look up preview images for them.

**Sync with your browser's bookmarks**, while it is on, sends what you change
in the **bukmark** folder as you change it:

| When you | It sends |
| -- | -- |
| Add, rename or move a bookmark | The bookmark's address, title and folder |
| Delete a bookmark | Which link to archive |
| Add, rename or delete a folder | The folder's name |
| Turn sync on | The bookmarks already in the folder that your server lacks |

Every 5 minutes, when the browser starts and after a save, it asks your server
what changed (`GET /api/links/changes`) and updates the folder to match. Only
`http://` and `https://` bookmarks are sent. In Firefox, taking back the
permission to share bookmarks with your server, in `about:addons`, turns sync
off, and nothing more is sent.

Import reads all your bookmarks. Sync reads and changes only the bukmark
folder, and sends nothing about bookmarks outside it: it looks outside only to
find the folder in Other bookmarks, and to see whether a bookmark your browser
reports as changed is in it. Bookmarks are read at no other time.

#### Logging in and out

- **Log in** opens your server's own login page in a browser window or tab. You
  type your password there, on your server's page, never into the extension.
  The extension then trades a one-time code for an access token with your
  server.
- With **Use an access token instead**, the token you paste is sent to your
  server to check it.
- **Log out** asks your server to revoke the token. So does saving a different
  server address while logged in, or a new login that replaces an old one.

The access token goes only to the server that issued it. For a server that is
not on your own computer, use an `https://` address: over plain `http://`,
everything the extension sends, the token included, crosses the network
unencrypted. See [HTTPS](/docs/install/#https).

### What it keeps in your browser

- The server address, in `storage.sync`. If you use browser sync, it follows you
  to your other devices. Where there is no sync storage, it stays in
  `storage.local`.
- The access token, in `storage.local` on this device. Log out deletes it.
- With bookmark sync on, the address and title of each link in the bukmark
  folder and which bookmarks hold it, in `storage.local`, with changes waiting
  to be sent. Turning sync off drops the waiting changes and keeps the list, so
  that turning it on again finds the same bookmarks.
- Short-lived state, such as a login in progress, the last error message and
  the folder changes a sync is making, in `storage.session`, which the browser
  empties when it closes.

Apart from bookmark sync's list, it keeps no history and no list of what you saved.

### What it never does

It has no content scripts: it never reads, changes or runs code in the pages you
visit. The one exception is saving a quote: when you choose
**Save quote to bukmark** or press its shortcut, it runs one line in that tab
that reads the text you selected, and nothing else. It sees the address and
title of the tab you are on only when you open the popup, press a shortcut or
choose that menu item, which is what `activeTab` allows.

In Chrome, Edge and Firefox it has no `tabs` permission, so it sees no other tab's
address at all. When a login finishes in a tab, it sees that tab's address
because the page is on your server, which you gave it access to. Safari's build
keeps the `tabs` permission so that its logins, which always run in a tab, can
follow theirs. It keeps and sends nothing about any other tab.

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
| `http://*/*`, `https://*/*` | Optional, and not granted at install. When you enter another server address, your browser asks you to allow that one address. The extension never asks for every site. |

Safari's build has no `bookmarks` or `identity` permission, since Safari has
neither API, and no `alarms`, since without bookmarks there is nothing to sync.

### Limited Use

bukmark capture's use of the data it handles follows the Chrome Web Store User
Data Policy, including the Limited Use requirements. It uses that data only to
save pages to your server and keep the bukmark folder in sync with it. It never
sells it, uses it for ads, or passes it to anyone else.

## Your bukmark server

Your server keeps what you save in its Postgres database:

- each link's address, title, note and hubs
- when and how it was saved
- the folder an imported bookmark came from
- a preview image address
- the page text described below

Your password, access tokens and sign-in sessions are stored only as hashes. The
first 12 characters of each token are kept too, to tell tokens apart.

### Reading saved pages

When you save a page, the server fetches the top of it once, to find its
preview image.

By default it also fetches each saved page in the background, about 20 a
minute, and again every 30 days. It keeps the page's text, for search and as a
copy, and marks pages that are gone as broken. It fetches only public
addresses. The sites you save see these requests come from your server, which
names itself as bukmark.

Setting `BUKMARK_CHECK_PAGES=false` stops the background checks
([Install](/docs/install/#environment-variables)). The server then fetches pages
only when asked: when you save one, for its preview image; after an import from
the extension, for the preview image of every link that has not had one looked
up yet; and when a check or a preview-image lookup is requested through the
[API](/docs/api/#post-apilinkscheck).

### Logs

The server logs each request to its console: the time, the IP address it came
from, and the address requested. For the popup's check, that
address includes the page's address. Tokens and cookies are left out. Under
Docker, this output is kept like any container's; bukmark stores it nowhere else.

### The web app

The web app keeps you signed in with one cookie, `bukmark_session`, for 30 days.
It loads its fonts from Google Fonts (`fonts.googleapis.com` and
`fonts.gstatic.com`). It loads each link's preview image from wherever the saved
page keeps it, without telling that server which page showed it.

### MCP clients

If you sort with an [MCP client](/docs/sorting/), what it reads from your server
(addresses, titles, notes, folder hints and hubs) goes to that client, and to
whoever runs the AI model behind it.

## Deleting your data

- **The extension's login:** click **Log out** on the extension's settings page.
  It deletes the token from your browser and asks your server to revoke it. If
  the server can't be reached, revoke **bukmark capture** in the web app under
  **Settings → Access tokens**. Removing the extension deletes everything it
  kept in that browser. The bukmark folder stays, as ordinary bookmarks.
- **A link:** open its **Edit** dialog in the web app, click **Delete…**, then
  **Delete**. Its title, note, hubs and saved text go with it. The server keeps
  only a SHA-256 hash of its address, so that importing the same bookmarks again
  doesn't bring it back, and the link's random id with the time it was deleted,
  so that a browser syncing its bookmarks removes it too.
- **Everything:** `bukmark uninstall --delete-data` stops bukmark and deletes its
  database volume, with every link, hub, token and session in it, along with
  its settings in `~/.bukmark`. From source, `docker compose down -v` in the
  checkout deletes the database volume.

## This website

bukmark.it is a static site. It has no accounts, no cookies and no analytics.
One service sees your visit:

- **Cloudflare Pages** hosts it and, like any web host, receives your IP address
  and the pages you request.

Its fonts come from bukmark.it too, so no font service sees your visit.

The docs remember whether you chose the light or dark theme in your browser's
local storage. That choice is not sent anywhere.

## Changes and contact

If what the extension sends changes, this page will say so before that version
is released, with a new date at the top. Its history is in the
[repository](https://github.com/xooxoxxo/bukmark).

Questions: open an issue at
[github.com/xooxoxxo/bukmark/issues](https://github.com/xooxoxxo/bukmark/issues).
Issues are public, so leave out anything private.
