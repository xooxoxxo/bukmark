---
title: Browser Extension
description: The capture extension for Chrome, Edge, Firefox and Safari — one-click saves, a keyboard shortcut, and bookmark import.
sidebar:
  order: 2
---

The extension sends what you save to your own server and nowhere else.
[Privacy](/docs/privacy/) lists what it sends and when, what it keeps in your
browser, and what each permission is for.

## Build

```bash
pnpm install
pnpm --filter @bukmark/extension build   # → apps/extension/dist/{chrome,firefox,safari}
```

One build makes a folder per browser family. They share the same code; only
the `manifest.json` differs. `build:chrome`, `build:firefox` and `build:safari`
build a single one.

## Load Into Your Browser

### Chrome, Edge, Brave, Opera, Vivaldi, Arc

Open the browser's extensions page (`chrome://extensions`; `edge://extensions`
in Edge, `brave://extensions` in Brave), turn on **Developer mode**, choose
**Load unpacked**, and select `apps/extension/dist/chrome`.

### Firefox

Firefox 140 or later on the desktop. Open `about:debugging#/runtime/this-firefox`,
choose **Load Temporary Add-on…**, and select the `manifest.json` in
`apps/extension/dist/firefox`.

Firefox removes a temporary add-on when it quits. Keeping it for good needs
Mozilla's signature, which comes with the add-on's addons.mozilla.org listing;
that listing is also the only way onto Firefox for Android.

### Safari

Loading a folder takes Safari 26 or later on a Mac. Turn on
**Show features for web developers** in Safari's Settings › Advanced, then open
Settings › Developer, choose **Add Temporary Extension…**, confirm with your
password or Touch ID, and select `apps/extension/dist/safari`. Safari removes
it when it quits.

The extension itself runs on Safari 16.4 and later; on a Safari older than 26,
wrap `dist/safari` in an app with Xcode's `safari-web-extension-converter`
instead.

Safari has no bookmark import (it gives extensions no bookmarks API) — use the
web app's [file import](/docs/export/#import) instead. On an iPhone or iPad,
the extension needs an App Store build; until there is one, use
[an iOS Shortcut](/docs/phone/#ios-shortcut).

## Default URL

The extension talks to `http://localhost:3000` by default. Running the server
elsewhere? Enter its address when you log in, or set it on the extension's
options page — your browser asks permission for that address the first time.

That permission is all the server needs: the extension reaches it through the
host access you grant, not through CORS, so `CORS_ORIGINS` stays empty. That
is documented for Chrome and Firefox and tested in both; Safari hasn't been
tested yet.

## Logging in

The extension saves nothing until it is logged in to your server. Right after
you install it, it opens its settings page with the setup steps on top: enter
your server's address, log in, and pin the button to your toolbar.

1. Click the extension's toolbar button. While logged out, the popup shows only
   a **Server** field and a **Log in** button.
2. Check the **Server** field — it defaults to `http://localhost:3000` — and
   click **Log in**. The first time, your browser asks permission to reach that
   address. In Firefox, the popup can't show that prompt for a new address, so
   it opens the extension's options page instead: click **Log in** there.
3. A window opens on your server. If you are not signed in to the web app in
   this browser, it asks for your bukmark password first.
4. The window then shows "bukmark capture wants to save bookmarks to this
   server", who is asking, and what it will be able to do: add and read your
   links and hubs. Click **Allow**, or **Deny** to cancel.

When the login finishes, the toolbar badge flashes `✓` and an open popup
switches to the save form by itself. The options page has the same **Log in**
button, under **Server**, and says which server you are signed in to.

If the server has no owner password yet, the window says so and asks you to
open the web app and create one first.

The login belongs to that server: the extension only ever sends its token to
the server that issued it, and changing the server URL logs you out.

### Which window opens

- **Chrome, Edge, Brave, Opera, Vivaldi, Arc and Firefox** open the browser's
  own login window, which closes by itself after **Allow**. The page names the
  extension: "a Chrome/Edge extension" with its ID — check it against the ID on
  the extension's card in `chrome://extensions` — or "a Firefox add-on" with the
  first 12 characters of its Firefox ID hash.
- **Safari, Firefox for Android, and any browser without that login window**
  open your server's login page in a small window or a new tab instead. The
  page names "the bukmark extension in this browser" — allow it only if you just
  clicked **Log in**. Meanwhile the popup and options page say "Finish signing
  in in the bukmark window." After **Allow**, the extension closes that window
  or tab itself; if it is still open, it reads "Signed in — you can close this
  tab". Closing it before then cancels the login, and a login left unfinished
  for 10 minutes times out.

### Unrecognised extension

The login page shows "Unrecognised extension — allow only if you built it
yourself" when the client asking is not one the server knows. By default it
knows only the official Firefox add-on, and warns about any other Firefox
add-on; Chrome extensions get no warning, since there is no Chrome Web Store
build yet. It only warns — **Allow** still works, because building the
extension yourself is normal.

To name the builds you trust, set `BUKMARK_EXTENSION_IDS` in the server's
environment to a comma-separated list of Chrome extension IDs and Firefox ID
hashes (the hex host of the login's `extensions.allizom.org` redirect). Once
it is set, only those are known, so include the official Firefox add-on's hash,
`79d9f60576061d67a8a6a23ee099801cbdd1ceef`, if you use it.

### Use an access token instead

Both the popup and the options page have **Use an access token instead**, for
when a login window won't do. Create a token in the web app under
**Settings → Access tokens** — one just for the extension — paste it, and click
**Use token**. The extension checks it with the server first, then keeps it
exactly like a login's: bound to that server, and revoked when you log out.
This works in every browser.

## Logging out

On the extension's options page, click **Log out** under **Server**. The
extension asks the server to revoke its token, then forgets the token either
way. If the server can't be reached, the extension still logs out locally, but
the token stays valid on the server until you revoke **bukmark capture** under
**Settings → Access tokens** in the web app.

Saving a different server URL on the options page while logged in logs out the
same way first.

## Usage

- **Toolbar button** — save the current tab with an optional note on why it's
  worth keeping. Before you save, the popup says what bukmark already has: the
  page itself and the hubs it is in ("Already saved — in rust"), or else how
  many links from the same site you have and the hub most of them are in. A
  saved page keeps its hub selected. While logged out, the popup shows the
  **Log in** form instead.
- **`Alt+Shift+K`** (Windows, Linux, ChromeOS) / **`Control+Shift+K`** (Mac) —
  save silently, no popup, no note. The badge shows `✓` when it's saved and `!`
  when it fails; the next popup says why. While logged out, nothing is sent and
  the badge shows `?`.
- **Options → Server** — change the server URL, log in, or log out.
- **Options → Import all bookmarks** — one-shot import of your browser's
  bookmarks. Everything arrives unsorted; the folder each came from is kept as a
  *hint* for sorting later, never applied automatically. Safe to re-run: existing
  links aren't duplicated and anything you deleted here stays deleted. You must be
  logged in. The extension asks for access to your bookmarks only now, when you
  click Import, not at install; Firefox asks in the same prompt whether it may
  share them with your server. Not in Safari or Firefox for Android, which give
  extensions no bookmarks: there, export them to a file and use the web app's
  import.

### Keyboard shortcut

The popup shows the key your browser actually assigned, and
**Options → Keyboard shortcut** shows it too — or says none is set, which
happens when something else already uses the suggested key. To change it:

- **Chrome, Edge, Brave, Opera, Vivaldi, Arc** — `chrome://extensions/shortcuts`,
  which **Change shortcut** on the options page opens for you.
- **Firefox** — `about:addons` › the gear menu › **Manage Extension Shortcuts**,
  also one click away with **Change shortcut**.
- **Safari** — Settings › Extensions (Safari 26 and later).

No key combination is documented as free in every browser. `Alt+Shift+K`
appears in none of the published shortcut lists for Chrome, ChromeOS, Edge,
Firefox, Safari or macOS, which is why it is the default. A Mac gets
`Control+Shift+K`, because `Option+Shift` and a letter types a character there.
One known clash: in Firefox on Windows and Linux, a web page can claim
`Alt+Shift+K` for one of its own links — rebind the shortcut if that bites.
Firefox for Android has no extension shortcuts.

## Token revocation

The extension's token is listed in the web app under
**Settings → Access tokens** as "bukmark capture" (a token you pasted keeps the
name you gave it). Once you click **Revoke** there, the extension's next request
is refused, it forgets the token, and the popup shows the **Log in** form with
"Your session ended — log in again".
