---
title: Privacy
description: What the browser extension sends and when, what your own server keeps, and what this website loads.
sidebar:
  order: 9
---

Effective 28 September 2026.

bukmark is software you run yourself. There is no bukmark company server and no
bukmark account. The browser extension sends your data only to the bukmark
server you run, which keeps it in your own database. Whoever runs that server,
usually you, is in charge of the data on it. The people who make bukmark receive
none of it.

## The browser extension

bukmark capture sends data to one place: the server address you enter under
**Server**, which is `http://localhost:3000` unless you change it. It has no
analytics, no telemetry, no ads and no tracking, and it contacts no other address.

Some browsers describe this at install as data the extension's developer
collects. With bukmark capture it goes to your server, and the developers never
see it.

### What it sends, and when

While you are logged out, it sends nothing until you click **Log in** or
**Use token**. Once you are logged in:

- **Opening the popup** on a web page sends that page's address to your server
  (`GET /api/links/lookup`), so the popup can say whether it is already saved.
  It also asks for your list of hubs. Only `http://` and `https://` pages are
  ever sent: a local file, a browser page or anything else is not, not even to
  ask.
- **Save** in the popup sends the page's address and title, and your note and
  hub if you filled them in.
- **`Alt+Shift+K`** (`Control+Shift+K` on a Mac) sends the page's address and
  title.
- **Import all bookmarks** on the settings page sends every bookmark whose
  address starts with `http://` or `https://`: its address, title and folder.
  It then asks your server to look up preview images for them. The extension
  has no access to your bookmarks until then: the click asks your browser for
  it (and, in Firefox, whether it may share them with your server). Bookmarks
  are read at no other time, and never changed.
- **Log in** opens your server's own login page in a browser window or tab. You type
  your password there, on your server's page, never into the extension. The
  extension then trades a one-time code for an access token with your server.
  With **Use an access token instead**, the token you paste is sent to your
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
- Short-lived state, such as a login in progress and the last error message, in
  `storage.session`, which the browser empties when it closes.

It keeps no history and no list of what you saved.

### What it never does

It has no content scripts: it never reads, changes or runs code in the pages you
visit. It sees the address and title of the tab you are on only when you open
the popup or press the shortcut, which is what `activeTab` allows. In Chrome,
Edge and Firefox it has no `tabs` permission, so it sees no other tab's address
at all. When a login finishes in a tab, it sees that tab's address because the
page is on your server, which you gave it access to. Safari's build keeps the
`tabs` permission so that its logins, which always run in a tab, can follow
theirs. It keeps and sends nothing about any other tab.

### Permissions

| Permission | What it is for |
| -- | -- |
| `activeTab` | The address and title of the tab you are on, when you open the popup or press the shortcut. |
| `bookmarks` | Optional, and not granted at install. Asked for when you click **Import all bookmarks**, then used to read them. |
| `tabs` | Safari only: following the tab a login opens, since Safari has no login window. |
| `storage` | Keeping the server address, the token and short-lived login state. |
| `identity` | Opening your server's login page in the browser's login window. No Google or other account is involved. |
| `http://localhost/*` | Reaching a server on your own computer, such as the default `http://localhost:3000`. |
| `http://*/*`, `https://*/*` | Optional, and not granted at install. When you enter another server address, your browser asks you to allow that one address. The extension never asks for every site. |

Safari's build has no `bookmarks` or `identity` permission, since Safari has
neither API.

bukmark capture's use of the data it handles follows the Chrome Web Store User
Data Policy, including the Limited Use requirements. It uses that data only to
save pages to your server. It never sells it, uses it for ads, or passes it to
anyone else.

## Your bukmark server

Your server keeps what you save in its Postgres database: each link's address,
title, note and hubs, when and how it was saved, the folder an imported bookmark
came from, a preview image address, and the page text described below. Your
password, access tokens and sign-in sessions are stored only as hashes. The first
12 characters of each token are kept too, to tell tokens apart.

### Reading saved pages

When you save a page, the server fetches the top of it once, to find its
preview image. By default it also fetches each saved page in the background,
about 20 a minute, and again every 30 days. It keeps the page's text, for search
and as a copy, and marks pages that are gone as broken. It fetches only public
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

If you sort with an [MCP client](/docs/sorting/), what it reads from your server
(addresses, titles, notes, folder hints and hubs) goes to that client, and to whoever
runs the AI model behind it.

## Deleting your data

- **The extension's login:** click **Log out** on the extension's settings page.
  It deletes the token from your browser and asks your server to revoke it. If
  the server can't be reached, revoke **bukmark capture** in the web app under
  **Settings → Access tokens**. Removing the extension deletes everything it
  kept in that browser.
- **A link:** open its **Edit** dialog in the web app, click **Delete…**, then
  **Delete**. Its title, note, hubs and saved text go with it. The server keeps
  only a SHA-256 hash of its address, so that importing the same bookmarks again
  doesn't bring it back.
- **Everything:** `bukmark uninstall --delete-data` stops bukmark and deletes its
  database volume, with every link, hub, token and session in it, along with
  its settings in `~/.bukmark`. From source, `docker compose down -v` in the
  checkout deletes the database volume.

## This website

bukmark.it is a static site. It has no accounts, no cookies and no analytics. Two services see your visit:

- **Cloudflare Pages** hosts it and, like any web host, receives your IP address
  and the pages you request.
- **Google Fonts** serves its fonts from `fonts.googleapis.com` and
  `fonts.gstatic.com`, so your browser also asks Google for those files.

The docs remember whether you chose the light or dark theme in your browser's
local storage. That choice is not sent anywhere.

## Changes and contact

If what the extension sends changes, this page will say so before that version
is released, with a new date at the top. Its history is in the
[repository](https://github.com/xooxoxxo/bukmark).

Questions: open an issue at
[github.com/xooxoxxo/bukmark/issues](https://github.com/xooxoxxo/bukmark/issues).
Issues are public, so leave out anything private.
