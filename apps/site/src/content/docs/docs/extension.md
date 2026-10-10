---
title: Browser Extension
description: The capture extension for Chrome, Edge, Firefox and Safari — one-click saves, a keyboard shortcut, and bookmark import and sync.
sidebar:
  order: 2
---

Build the extension, load it into your browser and log in to your server.

## Build

```bash
pnpm install
pnpm --filter @bukmark/extension build   # → apps/extension/dist/{chrome,firefox,safari}
```

`build:chrome`, `build:firefox` and `build:safari` build one browser only.

## Load into your browser

### Chrome, Edge, Brave, Opera, Vivaldi, Arc

1. Open `chrome://extensions` (`edge://extensions` in Edge,
   `brave://extensions` in Brave).
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select `apps/extension/dist/chrome`.

### Firefox

Needs Firefox 140 or later on the desktop.

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on…**.
3. Select the `manifest.json` in `apps/extension/dist/firefox`.

Firefox removes a temporary add-on when it quits.

### Safari

Needs Safari 26 or later on a Mac.

1. In Safari's Settings › Advanced, turn on
   **Show features for web developers**.
2. Open Settings › Developer and choose **Add Temporary Extension…**.
3. Confirm with your password or Touch ID.
4. Select `apps/extension/dist/safari`.

Safari removes it when it quits. The extension runs on Safari 16.4 and later:
on a Safari older than 26, wrap `dist/safari` in an app with Xcode's
`safari-web-extension-converter`. On iPhone or iPad, use
[an iOS Shortcut](/docs/phone/#ios-shortcut).

## Logging in

1. Click the extension's toolbar button. While logged out, the popup shows a
   **Server** field and a **Log in** button.
2. Check the **Server** field (default `http://localhost:3000`) and click
   **Log in**. Allow the browser to reach that address. In Firefox, the options
   page opens instead: click **Log in** there.
3. A window opens on your server. If you are not signed in to the web app in
   this browser, enter your bukmark password.
4. The window shows "bukmark capture wants to save bookmarks to this server".
   Click **Allow**, or **Deny** to cancel.

If the server has no password yet, create one in the web app first.

### Which window opens

- **Chrome, Edge, Brave, Opera, Vivaldi, Arc:** the browser's login window. The
  page names "a Chrome/Edge extension" with its ID, which should match the ID
  in `chrome://extensions`.
- **Firefox:** the browser's login window. The page names "a Firefox add-on"
  with the start of its ID hash.
- **Safari, Firefox for Android and others:** your server's login page, in a
  window or tab. The page names "the bukmark extension in this browser"; allow
  it only if you just clicked **Log in**. Meanwhile the popup says "Finish
  signing in in the bukmark window." The tab closes itself after **Allow**, or
  reads "Signed in — you can close this tab". A login left for 10 minutes times
  out.

### Unrecognised extension

The login page shows "Unrecognised extension — allow only if you built it
yourself" for a build the server doesn't know. **Allow** still works. To name
the builds you trust, set `BUKMARK_EXTENSION_IDS` on the server to a
comma-separated list of Chrome extension IDs and Firefox ID hashes. Include the
official Firefox add-on's hash, `79d9f60576061d67a8a6a23ee099801cbdd1ceef`, if
you use it.

### Use an access token instead

1. In the web app, create a token under **Settings → Access tokens**.
2. In the popup or on the options page, click **Use an access token instead**.
3. Paste the token and click **Use token**.

## Usage

- **Toolbar button** — save the current tab, with an optional note. The popup
  shows if it is already saved, and in which hubs.
- **`Alt+Shift+K`** (Windows, Linux, ChromeOS) / **`Control+Shift+K`** (Mac) —
  save without the popup. The badge shows `✓` when saved, `!` when it failed
  (open the popup to see why) and `?` when you are logged out.
- **Save quote to bukmark** — select text, right-click it and choose this item,
  or press **`Alt+Shift+Q`** (Windows, Linux, ChromeOS) /
  **`Control+Shift+Q`** (Mac). Saves the text as a quote, and the page too. It
  shows the same badges as the shortcut. See [Quotes](/docs/quotes/).
- **Options → Server** — change the server URL, log in, or log out.

### Keyboard shortcut

**Options → Keyboard shortcut** shows the keys your browser assigned. Change
them here:

| Browser | Where |
| --- | --- |
| Chrome, Edge, Brave, Opera, Vivaldi, Arc | `chrome://extensions/shortcuts` (**Change shortcut** on the options page opens it) |
| Firefox | `about:addons` › the gear menu › **Manage Extension Shortcuts** (also **Change shortcut**) |
| Safari | Settings › Extensions (Safari 26 and later) |
| Firefox for Android | No extension shortcuts |

### Import all bookmarks

1. While logged in, click **Import all bookmarks** on the options page.
2. Allow access to your bookmarks when your browser asks.

Everything arrives unsorted. Running it again adds no duplicates.

Safari and Firefox for Android can't import: export your bookmarks to a file
and use the web app's [file import](/docs/export/#import).

## Sync with your bookmarks

Sync keeps a **bukmark** folder in your browser's Other bookmarks and your
server the same, both ways.

1. On the options page, check **Sync with your browser's bookmarks** while
   logged in.
2. Allow access to your bookmarks when your browser asks.

The folder holds a folder per hub and **Unsorted** for links in none (a hub
called Unsorted gets **Unsorted (hub)**).

:::caution
**One browser per synced profile:** if Chrome Sync or Firefox Sync also carries
your bookmarks to another browser, turn bukmark sync on in only one of them.
Chrome says so on the options page; Firefox can't tell.
:::

### What a change does

Your changes go to the server at once. Server changes arrive every 5 minutes,
when the browser starts, and after a save from the popup or the shortcut.
**Sync now** fetches them at once.

| In the folder | On your server |
| --- | --- |
| Add a bookmark | Saved to the hub its folder is named after |
| Move a bookmark | Its hubs change |
| Add a folder | A new hub |
| Rename a folder | Its hub is renamed |
| Delete a bookmark | The link is archived (or only leaves this hub, if bookmarked elsewhere in the folder) |
| Delete a hub folder | The hub is archived; its links stay |
| Move a bookmark or folder out of the bukmark folder | Counts as deleting it |

**Deleting** never deletes anything on the server. Deleting or renaming
Unsorted changes nothing on the server: the next sync puts it back.

Turned on for another server, sync renames the old folder to
**bukmark (old server's address)** and starts a new one.

Safari and Firefox for Android give extensions no bookmarks, so they have no sync.
In Firefox, a change made in the folder in the first minute after you turn sync
on can be missed.

### Turning it off

Uncheck the same box. The folder stays as it is; changes not yet sent are
dropped. To delete the folder, turn sync off first, or it comes back.

Logging out or changing the server turns sync off too.

## Logging out

On the options page, click **Log out** under **Server**. If the server
can't be reached, revoke the token under **Settings → Access tokens** in the
web app.

### Token revocation

The extension's token appears under **Settings → Access tokens** as "bukmark
capture". Click **Revoke** there and the popup shows the **Log in** form with
"Your session ended — log in again".

## Server address

The extension sends what you save only to your server; see
[Privacy](/docs/privacy/). To use a server other than `http://localhost:3000`,
enter its address when you log in, or under **Options → Server**. Changing it
logs you out. No CORS setup is needed.
