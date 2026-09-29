---
title: Browser Extension
description: The capture extension for Chrome, Edge, Firefox and Safari — one-click saves, a keyboard shortcut, and bookmark import and sync.
sidebar:
  order: 2
---

Build the extension, load it into your browser and log it in to your server.
After that, one click or one key saves the page you are on.

## Build

```bash
pnpm install
pnpm --filter @bukmark/extension build   # → apps/extension/dist/{chrome,firefox,safari}
```

One build makes a folder per browser family, with the same code and its own
`manifest.json`. `build:chrome`, `build:firefox` and `build:safari` build a
single one.

## Load Into Your Browser

### Chrome, Edge, Brave, Opera, Vivaldi, Arc

1. Open the browser's extensions page: `chrome://extensions`
   (`edge://extensions` in Edge, `brave://extensions` in Brave).
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select `apps/extension/dist/chrome`.

### Firefox

Needs Firefox 140 or later on the desktop.

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on…**.
3. Select the `manifest.json` in `apps/extension/dist/firefox`.

Firefox removes a temporary add-on when it quits. Keeping it for good needs
Mozilla's signature, which comes with the add-on's addons.mozilla.org listing;
that listing is also the only way onto Firefox for Android.

### Safari

Loading a folder takes Safari 26 or later on a Mac.

1. In Safari's Settings › Advanced, turn on
   **Show features for web developers**.
2. Open Settings › Developer and choose **Add Temporary Extension…**.
3. Confirm with your password or Touch ID.
4. Select `apps/extension/dist/safari`.

Safari removes it when it quits.

<details>
<summary>Older Safari, iPhone and iPad</summary>

The extension itself runs on Safari 16.4 and later; on a Safari older than 26,
wrap `dist/safari` in an app with Xcode's `safari-web-extension-converter`
instead.

On an iPhone or iPad, the extension needs an App Store build; until there is
one, use [an iOS Shortcut](/docs/phone/#ios-shortcut).

</details>

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
4. The window shows "bukmark capture wants to save bookmarks to this server",
   who is asking, and what it will be able to do: add and read your links and
   hubs. Click **Allow**, or **Deny** to cancel.

When the login finishes, the toolbar badge flashes `✓` and an open popup
switches to the save form by itself. The options page has the same **Log in**
button, under **Server**, and says which server you are signed in to.

If the server has no owner password yet, the window says so and asks you to
open the web app and create one first.

### Which window opens

- **Chrome, Edge, Brave, Opera, Vivaldi, Arc:** the browser's own login window,
  which closes by itself after **Allow**. The page names "a Chrome/Edge
  extension" with its ID; check it against the ID on the extension's card in
  `chrome://extensions`.
- **Firefox:** the browser's own login window, which closes by itself after
  **Allow**. The page names "a Firefox add-on" with the first 12 characters of
  its Firefox ID hash.
- **Safari, Firefox for Android, and any browser without that login window:**
  your server's login page, in a small window or a new tab. The page names "the
  bukmark extension in this browser"; allow it only if you just clicked
  **Log in**.

In that last case, while your server's login page is open, the popup and
options page say "Finish signing in in the bukmark window." After **Allow**, the
extension closes that window or tab itself; if it is still open, it reads
"Signed in — you can close this tab". Closing it before then cancels the login,
and a login left unfinished for 10 minutes times out.

### Unrecognised extension

The login page shows "Unrecognised extension — allow only if you built it
yourself" when the client asking is not one the server knows. It only warns —
**Allow** still works, because building the extension yourself is normal.

By default the server knows only the official Firefox add-on, and warns about
any other Firefox add-on. Chrome extensions get no warning, since there is no
Chrome Web Store build yet.

To name the builds you trust, set `BUKMARK_EXTENSION_IDS` in the server's
environment to a comma-separated list of Chrome extension IDs and Firefox ID
hashes (the hex host of the login's `extensions.allizom.org` redirect). Once
it is set, only those are known, so include the official Firefox add-on's hash,
`79d9f60576061d67a8a6a23ee099801cbdd1ceef`, if you use it.

### Use an access token instead

For when a login window won't do. This works in every browser.

1. In the web app, create a token under **Settings → Access tokens**, one just
   for the extension.
2. In the popup or on the options page, click **Use an access token instead**.
3. Paste the token and click **Use token**.

The extension checks it with the server first, then keeps it exactly like a
login's: bound to that server, and revoked when you log out.

## Usage

- **Toolbar button** — save the current tab with an optional note on why it's
  worth keeping. Before you save, the popup says what bukmark already has: the
  page itself and the hubs it is in ("Already saved — in rust"), or else how
  many links from the same site you have and the hub most of them are in. A
  saved page keeps its hub selected.
- **`Alt+Shift+K`** (Windows, Linux, ChromeOS) / **`Control+Shift+K`** (Mac) —
  save silently, no popup, no note. The badge shows `✓` when it's saved and `!`
  when it fails; the next popup says why. While logged out, nothing is sent and
  the badge shows `?`.
- **Options → Server** — change the server URL, log in, or log out.

### Keyboard shortcut

The popup shows the key your browser actually assigned, and
**Options → Keyboard shortcut** shows it too — or says none is set, which
happens when something else already uses the suggested key. To change it:

| Browser | Where |
| --- | --- |
| Chrome, Edge, Brave, Opera, Vivaldi, Arc | `chrome://extensions/shortcuts`, which **Change shortcut** on the options page opens for you |
| Firefox | `about:addons` › the gear menu › **Manage Extension Shortcuts**, also one click away with **Change shortcut** |
| Safari | Settings › Extensions (Safari 26 and later) |
| Firefox for Android | No extension shortcuts |

<details>
<summary>Why this key, and one known clash</summary>

No key combination is documented as free in every browser. `Alt+Shift+K`
appears in none of the published shortcut lists for Chrome, ChromeOS, Edge,
Firefox, Safari or macOS, which is why it is the default. A Mac gets
`Control+Shift+K`, because `Option+Shift` and a letter types a character there.

One known clash: in Firefox on Windows and Linux, a web page can claim
`Alt+Shift+K` for one of its own links — rebind the shortcut if that bites.

</details>

### Import all bookmarks

A one-shot import of your browser's bookmarks.

1. While logged in, click **Import all bookmarks** on the options page.
2. Allow access to your bookmarks when your browser asks. Firefox asks in the
   same prompt whether it may share them with your server.

Everything arrives unsorted; the folder each came from is kept as a *hint* for
sorting later, never applied automatically. Safe to re-run: existing links
aren't duplicated and anything you deleted here stays deleted. The extension
asks for access to your bookmarks only when you click Import, not at install.

Safari and Firefox for Android have no import, since they give extensions no
bookmarks: export your bookmarks to a file there and use the web app's
[file import](/docs/export/#import).

## Sync with your bookmarks

Sync keeps a **bukmark** folder in your browser's Other bookmarks and your
server the same, both ways. It reads and changes only that folder.

1. On the options page, check **Sync with your browser's bookmarks** while
   logged in.
2. Allow access to your bookmarks when your browser asks. The folder then
   fills.

Inside the folder is a folder for each hub and **Unsorted** for links in none
(a hub called Unsorted gets **Unsorted (hub)**). A link in two hubs has a
bookmark in both; archived links are left out. Folders inside a hub folder are
not synced.

:::caution
**One browser per synced profile:** if Chrome Sync or Firefox Sync also carries
your bookmarks to another browser, turn bukmark sync on in only one of them.
Two would each see the other's changes as yours. Chrome says so on the options
page; Firefox can't tell.
:::

### What a change does

Your changes in the folder go to your server at once. Server changes arrive
every 5 minutes, when the browser starts, and after a save from the popup or
the shortcut. **Sync now** fetches them at once.

| In the folder | On your server |
| --- | --- |
| Add a bookmark | Saved to the hub its folder is named after |
| Move a bookmark | Its hubs change |
| Add a folder | A new hub |
| Rename a folder | Its hub is renamed |
| Delete a bookmark | Its link is archived; you can restore it in the web app. If the link still has another bookmark in the folder, it is not archived: it leaves this hub, unless another bookmark of it is still in this hub's folder. |
| Delete a hub folder | The hub is archived. Its links stay: at the next sync they show up in their other hub folders, or in Unsorted. |
| Move a bookmark or folder out of the bukmark folder | Counts as deleting it |

**Deleting** never deletes anything on the server. Deleting or renaming
Unsorted changes nothing on the server: the next sync puts it back.

<details>
<summary>When the server is unreachable or refuses a change</summary>

While the server can't be reached, changes wait. If it refuses one, the options
page says why and the next sync undoes it.

</details>

### Turning it off

Uncheck the same box. The folder stays as it is; changes not yet sent are
dropped. To remove the folder, turn sync off first, or the next sync makes it
again.

Logging out or changing the server turns sync off too. So does taking back the
extension's access to your bookmarks, or, in Firefox, its permission to share
them with your server.

<details>
<summary>A bukmark folder you already have, or another server</summary>

Bookmarks already in a bukmark folder there when you turn sync on are kept, and
any your server lacks are sent to it.

Turned on for another server, sync renames the old folder to
**bukmark (old server's address)**, leaves it alone from then on, and starts a
new one.

</details>

<details>
<summary>Limits</summary>

Tested in Chrome and Firefox. Safari and Firefox for Android give extensions no
bookmarks, so they have no sync. A server too old to sync says so on the
options page, and sync stays off.

In Firefox, a change made in the folder in the first minute after you turn sync
on can be missed: a new bookmark still reaches the server at the next sync, but
a bookmark moved, renamed or deleted then is put back.

</details>

## Logging out

On the extension's options page, click **Log out** under **Server**. The
extension asks the server to revoke its token, then forgets the token either
way. Saving a different server URL on the options page while logged in logs out
the same way first.

If the server can't be reached, the extension still logs out locally, but the
token stays valid on the server until you revoke it in the web app, as below.

### Token revocation

The extension's token is listed in the web app under
**Settings → Access tokens** as "bukmark capture" (a token you pasted keeps the
name you gave it). Once you click **Revoke** there, the extension's next request
is refused, it forgets the token, and the popup shows the **Log in** form with
"Your session ended — log in again".

## Server address

The extension sends what you save to your own server and nowhere else.
[Privacy](/docs/privacy/) lists what it sends and when, what it keeps in your
browser, and what each permission is for.

It talks to `http://localhost:3000` by default. For a server elsewhere, enter
its address when you log in, or set it under **Options → Server**; your browser
asks permission for that address the first time.

- **One server per login.** The extension only ever sends its token to the
  server that issued it, and changing the server URL logs you out.
- **No CORS setup.** The extension reaches the server through the host access
  you grant, not through CORS, so `CORS_ORIGINS` stays empty. That is
  documented for Chrome and Firefox and tested in both; Safari hasn't been
  tested yet.
