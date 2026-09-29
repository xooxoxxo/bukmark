---
title: Quotes
description: Save the passage that matters, not just the page, from your browser, an Android phone or an iPhone, then search, note and copy it in the web app.
sidebar:
  order: 4
---

A quote is a passage you selected on a page, saved with where it came from.
Save one from your browser or your phone, and find it again under **Quotes** in
the web app, with the page's title and address beside it.

Every quote goes to your own server, and saving one also saves its page if you
haven't already, unsorted like any other capture.

## Save from your browser

This needs the [browser extension](/docs/extension/), logged in to your server.

1. Select the text on the page.
2. Right-click it and choose **Save quote to bukmark**, or press
   **`Alt+Shift+Q`** (**`Control+Shift+Q`** on a Mac).
3. Watch the toolbar button's badge: `✓` means it is saved, `!` that it failed
   (the next time you open the popup, it says why), `?` that you are logged out.

With nothing selected, the shortcut does nothing, and the right-click item
only appears on a selection. A quote keeps the line breaks of your selection.

<details>
<summary>The shortcut isn't working, or the item is missing</summary>

Your browser leaves a shortcut unset when something else already uses its key.
**Options → Keyboard shortcut** on the extension's options page shows the key
your browser assigned for saving a link and for saving a quote, or says that
none is set, and **Change shortcut** there takes you to where you change it.
The extension's popup doesn't show them.

Only `http://` and `https://` pages can be quoted from: on a browser's own pages
or a local file, nothing is saved. On a page the browser won't let the
extension read, such as an extension store, the right-click item still saves
your selection, but with its line breaks turned to spaces, and the shortcut
does nothing. Safari on iPhone and iPad has no right-click item, and Firefox
for Android has neither the item nor a shortcut.

</details>

## Save from Android

Android shares selected text to the installed web app the way it shares a page,
so set that up first: [Android share sheet](/docs/phone/#android-share-sheet).

1. In Chrome, select the text on the page, then choose **Share** from the menu
   over the selection.
2. Pick **bukmark** from the Share sheet.
3. bukmark opens the passage, without the link Chrome adds to it, with the
   page's title and site under it and a note field.
4. Tap **Save quote**. To keep the page but not the passage, tap
   **Save link only** instead. The note goes with whichever you tap, and
   nothing is saved until you do.

<details>
<summary>When a share counts as a quote</summary>

Sharing a page's link, or a headline with a link after it, stays a link share:
you get the usual save form with the title and hub. A share becomes a quote when
it carries a passage from a page:

- Chrome's shared selection, which ends in a link to the page with
  `#:~:text=` and is wrapped in quotation marks.
- Text sent together with a separate page link, when an app shares both.

A share that is only a link, or only the page's title, is never a quote.

</details>

## Save from an iPhone

An iOS Shortcut sends the selected text to your server, as the
[link Shortcut](/docs/phone/#ios-shortcut) sends a page. It needs an access token
and HTTPS, so set the link Shortcut up first, or at least create its token.

1. In the web app, create a token under **Settings → Access tokens**, named
   for the phone, and copy it. Reuse the link Shortcut's token if you like.
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
     action's result and a text field `url` set to the second's
7. Optionally add **Show Notification** after it, so you see that it ran.
8. In Safari, select text on a page, tap **Share** and pick
   **Save quote to bukmark**.

The Shortcut saves at once, with no form, and the page lands unsorted if it was
not saved yet. Saving the same passage from the same page again does nothing
new. Keep the token to yourself: read
[Don't share this shortcut](/docs/phone/#ios-shortcut) before you share this one.

:::caution[This Shortcut still needs a device test]
The action and option names above follow Apple's Shortcuts guide, but this
Shortcut hasn't been tried on a device, and iOS versions name them a little
differently. If saving fails, check the token and the request from a computer
first:

```bash
curl -f -H "Authorization: Bearer <your-token>" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","text":"A passage."}' https://<your-server>/api/quotes
```
:::

<details>
<summary>Send a title or a note too</summary>

The body can also carry `title` (the page's title, used when the page isn't
saved yet) and `note`. See [`POST /api/quotes`](/docs/api/#post-apiquotes).

</details>

## Read your quotes

**Quotes** in the sidebar lists every quote you have saved, newest first, with the
number of them beside it. Each shows its passage, your note, the page's title
and site (a link back to the page), and the date you saved it.

- **Search:** the box at the top finds words in a quote's text and in its
  note. Search doesn't read the page's title.
- **Copy** puts the quote on your clipboard, ready to paste:

  ```text
  "The quoted passage."
  — Page title, example.com/article
  ```

  The last line is the page's title and its address without `https://`, `www.`,
  the query and the fragment. A page saved with no title shows the address alone.
- **The note:** click it, or **Add a note**, type, and press Enter or leave the
  field to save. Shift+Enter starts a new line and Escape puts the note back.
- **Edit** opens a dialog for the quote's text and its note. Save it with
  **Save**. A page can't have two quotes with the same text, so a text another
  quote from that page already has is refused.
- **Delete** asks once more, and **Delete for good** removes the quote. It
  can't be undone.

The list loads more as you scroll, or with **Load more**.

## Quotes on a link

A link with quotes shows a marker, "1 quote" or "N quotes", in its row or card.
Open that link's **Edit** dialog to read them under **Quotes**, each with
**Copy**. Change or delete a quote from **Quotes** in the sidebar.

## What counts as the same quote

The same passage from the same page is one quote, even if the case or the spacing
differs: saving it again adds nothing and changes nothing. Saving from a page
you have already saved doesn't count it as seen again, either.

## When you delete a link

Deleting a link never deletes its quotes. They stay under **Quotes**, still
showing the page's title and address, but on no link: the marker and the **Edit**
dialog of a link list only the quotes it has. A page you save again later starts
with none of them.

## Backups

A [JSON backup](/docs/export/#quotes-in-a-backup) includes your quotes, and
importing it puts them back. When it finishes, the result line says how many
quotes were **restored**, how many were **already here**, and how many were
**not restored**, which are the few the file held that could not be read. A
quote whose page you deleted comes back too, on no page, still showing where it
was saved from. The HTML and CSV exports don't include quotes.
