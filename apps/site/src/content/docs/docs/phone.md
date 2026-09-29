---
title: Capture from your phone
description: Save to bukmark from Android's Share sheet, an iOS Shortcut, or a bookmarklet — no extension needed.
sidebar:
  order: 3
---

Phones mostly can't run the browser extension, so bukmark offers three other
ways in. Set up the one that fits your device, and sharing a page saves it to
your own server.

| Way | Works on | Needs |
| --- | --- | --- |
| [Android share sheet](#android-share-sheet) | Chrome, Samsung Internet or Opera on Android | HTTPS |
| [iOS Shortcut](#ios-shortcut) | iPhone or iPad, in any app that shares a link | HTTPS and an access token |
| [Bookmarklet](#bookmarklet) | A browser without the extension, such as Safari on a Mac | A sign-in to your server in that browser |

All three talk to your own server, so your phone has to reach it. For the
first two, set up [HTTPS](/docs/install/#https).

## Android share sheet

Installed like an app, the web app appears in Android's Share sheet.

1. Open your bukmark server in Chrome on the phone and sign in.
2. Open the browser menu (⋮) and choose **Install app**. If the menu says
   **Add to Home screen** instead and then offers **Install** and
   **Create shortcut**, pick **Install**: a shortcut doesn't appear in the
   Share sheet.
3. In any app, share a page and pick **bukmark** from the Share sheet.
4. bukmark opens a save form with the page's title and link filled in, a
   "Why keep it?" note and a hub picker. Tap **Save**: nothing is saved until
   you do.

Many Android apps share a link inside a line of text rather than on its own;
bukmark takes the first web link it finds there.

<details>
<summary>bukmark is missing from the Share sheet</summary>

Installing works in Chrome, Samsung Internet and Opera on Android, and needs
HTTPS: over plain `http://` the browser won't offer to install at all. Firefox
for Android and Safari have no share target for web apps.

If it is installed and still isn't there, remove bukmark's icon from your home
screen and install it again, picking **Install**.

</details>

## iOS Shortcut

On an iPhone or iPad, a Shortcut in the Share sheet can send the page straight
to your server with an access token.

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
     **Shortcut Input**
5. Optionally add **Show Notification** after it, so you see that it ran.
6. Share a page and pick **Save to bukmark**.

The Shortcut saves it straight away, with no form to confirm, and it lands
unsorted like any other capture. A link you already have is counted again, not
duplicated.

The token has full access to your bookmarks, so revoke it under
**Settings → Access tokens** if you lose the phone. Always use `https://` here:
the token travels in every request, and over plain `http://` anyone on the
network path can read it.

:::caution[Don't share this shortcut]
The token is saved inside the shortcut, and a copy you share — by iCloud link
or AirDrop — carries it along. Anyone with that copy has full access to your
bookmarks, and can use the token to create more tokens. If you have shared it,
revoke that token under **Settings → Access tokens**, along with any token
there you don't recognise.
:::

<details>
<summary>Send a title, note or hub too</summary>

The body can carry the other fields `POST /api/links` accepts — `title`,
`note`, `hub` — see the [API reference](/docs/api/#post-apilinks).

</details>

:::caution[The header step still needs a device test]
Apple's guide covers **Get Contents of URL** with POST and a JSON body, but it
doesn't document the **Headers** field. This step hasn't been tried on a device
yet. If saving fails, check the token from a computer first:

```bash
curl -f -H "Authorization: Bearer <your-token>" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}' https://<your-server>/api/links
```
:::

## Bookmarklet

For a browser without the extension, such as Safari on a Mac.

1. In the web app, open **Settings → Access tokens**.
2. Drag the **Save to bukmark** link from its Bookmarklet section to your
   bookmarks bar.
3. On any page, click the bookmarklet. A small window opens with the same save
   form as the Share sheet, filled in with that page.

The bookmarklet holds no token: the window it opens uses this browser's sign-in
to your server. If you aren't signed in, it asks you to sign in and then shows
the form again.

On a computer that isn't yours, log out when you're done
(**Settings → Log out**) and delete the bookmarklet. A sign-in lasts 30 days,
and using it extends that, so otherwise the next person at that browser opens
your server already signed in as you.

Some sites' security policy may stop bookmarklets from running; the extension
doesn't have that problem.

## The save page

The Share sheet and the bookmarklet both end on your server's `/save` page,
which you can also open yourself: `https://<your-server>/save?url=…&title=…`.
It never saves on its own — only the **Save** button does — so a link to it
from anywhere else can't add anything to your bookmarks. The iOS Shortcut
skips this page and saves as soon as you run it.
