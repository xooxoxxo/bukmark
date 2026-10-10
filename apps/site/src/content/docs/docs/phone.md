---
title: Capture from your phone
description: Save to bukmark from Android's Share sheet, an iOS Shortcut, or a bookmarklet — no extension needed.
sidebar:
  order: 3
---

Save to bukmark without the browser extension. Your phone must reach your
server.

| Way | Works on | Needs |
| --- | --- | --- |
| [Android share sheet](#android-share-sheet) | Chrome, Samsung Internet or Opera on Android | [HTTPS](/docs/install/#https) |
| [iOS Shortcut](#ios-shortcut) | iPhone or iPad, in any app that shares a link | [HTTPS](/docs/install/#https) and an access token |
| [Bookmarklet](#bookmarklet) | A browser without the extension, such as Safari on a Mac | A sign-in to your server in that browser |

## Android share sheet

Installing the web app needs HTTPS. Once installed, it appears in Android's
Share sheet.

1. Open your bukmark server in Chrome on the phone and sign in.
2. Open the browser menu (⋮) and choose **Install app**. If it says
   **Add to Home screen** and then offers **Install** and
   **Create shortcut**, pick **Install**: a shortcut doesn't appear in the
   Share sheet.
3. In any app, share a page and pick **bukmark**.
4. Check the form and tap **Save**.

Not in the Share sheet? Remove bukmark's icon from your home screen and
install it again with **Install**.

To save selected text instead, see [Quotes](/docs/quotes/#save-from-android).

## iOS Shortcut

1. In the web app, create a token under **Settings → Access tokens**, named for
   the phone (for example "iPhone"), and copy it.
2. In the Shortcuts app, create a new shortcut named "Save to bukmark".
3. In its details, turn on **Show in Share Sheet**, and have it receive only
   **URLs**.
4. Add the **Get Contents of URL** action. Set the URL to
   `https://<your-server>/api/links` and expand the action's options:
   - **Method:** `POST`
   - **Headers:** add `Authorization` with the value `Bearer <your-token>`
   - **Request Body:** `JSON`, with a text field `url` set to
     **Shortcut Input** (optional: `title`, `note`, `hub` — see the
     [API reference](/docs/api/#post-apilinks))
5. Optionally add **Show Notification** after it.
6. Share a page and pick **Save to bukmark**.

The Shortcut saves it straight away, with no form to confirm. Lost the phone?
Revoke the token under **Settings → Access tokens**.

:::caution[Don't share this shortcut]
The token is saved inside the shortcut, and a copy you share by iCloud link
or AirDrop carries it along. Anyone with that copy has full access to your
bookmarks, and can use the token to create more tokens. If you have shared it,
revoke that token under **Settings → Access tokens**, along with any token
there you don't recognise.
:::

:::caution[The header step still needs a device test]
If saving fails, test the token from a computer:

```bash
curl -f -H "Authorization: Bearer <your-token>" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}' https://<your-server>/api/links
```
:::

To save selected text instead, see [Quotes](/docs/quotes/#save-from-an-iphone).

## Bookmarklet

1. In the web app, open **Settings → Access tokens**.
2. Drag the **Save to bukmark** link from its Bookmarklet section to your
   bookmarks bar.
3. On any page, click the bookmarklet and save from the window it opens.

It uses this browser's sign-in to your server, not a token. On a
computer that isn't yours, log out when you're done (**Settings → Log out**)
and delete the bookmarklet: a sign-in lasts 30 days.

Some sites block bookmarklets; the extension works there.

## The save page

The Share sheet and the bookmarklet both open your server's `/save` page. You
can open it yourself: `https://<your-server>/save?url=…&title=…`. It saves only
when you click **Save**. The iOS Shortcut skips this page.
