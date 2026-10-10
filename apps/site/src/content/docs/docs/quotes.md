---
title: Quotes
description: Save the passage that matters, not just the page, from your browser, an Android phone or an iPhone, then search, note and copy it in the web app.
sidebar:
  order: 4
---

A quote is a passage you selected on a page, saved with its source. Saving one
also saves its page, unsorted, if you don't have it yet.

## Save from your browser

Needs the [browser extension](/docs/extension/), logged in.

1. Select text on the page.
2. Right-click it and choose **Save quote to bukmark**, or press
   **`Alt+Shift+Q`** (**`Control+Shift+Q`** on a Mac).
3. The toolbar badge shows `✓` when saved, `!` when it failed (open the popup to
   see why) and `?` when you are logged out.

Only `http://` and `https://` pages work. If the shortcut does nothing, check
**Options → Keyboard shortcut** on the extension's options page.

## Save from Android

Set up the [Android share sheet](/docs/phone/#android-share-sheet) first.

1. In Chrome, select text, then choose **Share** from the menu over it.
2. Pick **bukmark** from the Share sheet.
3. Tap **Save quote**, or **Save link only** to keep just the page.

## Save from an iPhone

Needs an access token and HTTPS, like the [link Shortcut](/docs/phone/#ios-shortcut).

1. In the web app, create a token under **Settings → Access tokens** and copy
   it. The link Shortcut's token works too.
2. In the Shortcuts app, create a new shortcut named "Save quote to bukmark".
3. In its details, turn on **Show in Share Sheet**, and have it receive only
   **Safari web pages**.
4. Add the **Get Details of Safari Web Page** action, set to get **Page
   Selection** from **Shortcut Input**.
5. Add a second **Get Details of Safari Web Page** action, set to get
   **Page URL** from **Shortcut Input**.
6. Add the **Get Contents of URL** action. Set the URL to
   `https://<your-server>/api/quotes` and expand the action's options:
   - **Method:** `POST`
   - **Headers:** add `Authorization` with the value `Bearer <your-token>`
   - **Request Body:** `JSON`, with a text field `text` set to the first
     action's result and a text field `url` set to the second's (optional:
     `title`, `note` — see [`POST /api/quotes`](/docs/api/#post-apiquotes))
7. Optionally add **Show Notification** after it.
8. In Safari, select text, tap **Share** and pick **Save quote to bukmark**.

Don't share this shortcut: it carries your token. See
[Don't share this shortcut](/docs/phone/#ios-shortcut).

:::caution[This Shortcut still needs a device test]
If saving fails, test the token and the request from a computer:

```bash
curl -f -H "Authorization: Bearer <your-token>" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","text":"A passage."}' https://<your-server>/api/quotes
```
:::

## Read your quotes

**Quotes** in the sidebar lists every quote, newest first. Search finds words
in a quote's text and note.

- **Copy** puts the quote on your clipboard:

  ```text
  "The quoted passage."
  — Page title, example.com/article
  ```

- **The note:** click it, or **Add a note**, type, and press Enter. Shift+Enter
  starts a new line; Escape cancels.
- **Edit** changes the quote's text and note.
- **Delete**, then **Delete for good**, removes the quote. There is no undo.

A link with quotes shows "1 quote" or "N quotes". Its **Edit** dialog lists
them under **Quotes**.

Deleting a link keeps its quotes under **Quotes**.

## Backups

A [JSON backup](/docs/export/#quotes-in-a-backup) includes your quotes, and
importing it restores them. HTML and CSV exports don't include quotes.
Highlights from an [Omnivore export](/docs/export/#omnivore-exports) import as
quotes too.
