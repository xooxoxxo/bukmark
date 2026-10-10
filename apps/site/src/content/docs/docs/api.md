---
title: API reference
description: Every REST endpoint bukmark serves, including the export endpoint.
sidebar:
  order: 7
---

Every REST endpoint your bukmark server serves.

## Start here

1. In the web app, open **Settings → Access tokens**, type a name and click
   **Create token**, then **Copy**. The token is shown only once.
2. Put it in a shell variable:

   ```bash
   export BUKMARK_TOKEN='bkm_…'
   ```

3. List your links:

   ```bash
   curl -H "Authorization: Bearer $BUKMARK_TOKEN" http://localhost:3000/api/links
   ```

4. Save a page. The answer has `"outcome": "created"` and the new link.

   ```bash
   curl -H "Authorization: Bearer $BUKMARK_TOKEN" -H "Content-Type: application/json" \
     -d '{"url": "https://example.com"}' http://localhost:3000/api/links
   ```

Use your server's address in place of `http://localhost:3000`.

## Quick reference

| Method | Path | Description |
| -- | -- | -- |
| GET | `/healthz` | Liveness check |
| GET | `/api/auth/status` | Check setup and authentication status |
| POST | `/api/auth/setup` | Create the owner password (first run only) |
| POST | `/api/auth/login` | Log in with owner password |
| POST | `/api/auth/token` | Exchange an authorization code for an access token |
| GET | `/authorize` | Extension sign-in and Allow page (HTML) |
| POST | `/authorize` | Sign-in, Allow and Deny form posts (HTML) |
| GET | `/authorize/done` | Landing page for a login in a browser tab (HTML) |
| POST | `/api/auth/logout` | Log out and clear session/token |
| GET | `/api/auth/tokens` | List all access tokens |
| POST | `/api/auth/tokens` | Create a new access token |
| DELETE | `/api/auth/tokens/:id` | Revoke an access token |
| GET | `/api/links` | List links with search and filters |
| GET | `/api/links/lookup` | Whether a page is saved, and how its site is filed |
| GET | `/api/links/changes` | Links changed or deleted since a time, for bookmark sync |
| GET | `/api/links/:id` | One link, with its saved page text and last check |
| POST | `/api/links/check` | Check the links most in need of it now |
| POST | `/api/links` | Create or update a link |
| POST | `/api/links/import` | Import a batch of links |
| POST | `/api/links/og-backfill` | Look up preview images not yet looked up |
| POST | `/api/links/:id/refresh` | Re-fetch preview image for one link |
| POST | `/api/links/assign` | Assign links to hubs in bulk |
| PATCH | `/api/links/:id` | Update a single link |
| POST | `/api/links/bulk` | Archive, activate, assign, or delete links |
| POST | `/api/quotes` | Save a passage from a page, saving the page too if needed |
| GET | `/api/quotes` | List quotes, newest first, with search and paging |
| PATCH | `/api/quotes/:id` | Edit a quote's text or note |
| DELETE | `/api/quotes/:id` | Delete a quote |
| GET | `/api/hubs` | List all hubs |
| POST | `/api/hubs` | Create a hub |
| PATCH | `/api/hubs/:id` | Update a hub |
| DELETE | `/api/hubs/:id` | Delete a hub |
| GET | `/api/stats` | Get link, hub and quote counts |
| GET | `/api/export` | Export links as HTML, JSON, or CSV |

## Authentication

Every `/api` endpoint except the public ones below needs the web app's session
cookie or a bearer token. Without one, the server answers `401`.

### Public endpoints

These need no credentials: `GET /healthz`, `GET /api/auth/status`,
`POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/token`,
`GET /authorize`, `POST /authorize` (authorization code flow with PKCE, `S256`
only) and `GET /authorize/done`.

Setup, login and `POST /authorize` require a same-host `Origin` header
([403](#403-cross-site-request-refused)). They and the token exchange are
rate-limited ([429](#429-too-many-requests)).

### Bearer tokens

Send `Authorization: Bearer <token>` (create a token as in
[Start here](#start-here)). A token works only on the server that issued it.
With a bearer header, only the token counts, not any cookie. A revoked token
gets `401` with `unauthenticated`.

### Session cookies

`POST /api/auth/setup` and `POST /api/auth/login` set a `bukmark_session`
cookie. A session lasts 30 days and is extended when used, at most once a day.
The cookie is:

- `HttpOnly`
- `Path=/`
- `SameSite=Lax`
- `Secure` only when the request arrived over HTTPS (behind a TLS proxy, only
  with `TRUST_PROXY=true`)
- `Max-Age=2592000` (30 days)

A POST, PUT, PATCH or DELETE authenticated by the cookie needs a matching
`Origin` header. Browsers send it.

### Error responses

#### 401 Unauthenticated

No valid credentials, or they expired or were revoked.

```json
{
  "error": "Not authenticated",
  "code": "unauthenticated"
}
```

The `error` text varies (`Invalid token`, `Session expired`); match on `code`.

#### 401 Setup required

Every protected endpoint returns this until the owner password is set.

```json
{
  "error": "Setup required",
  "code": "setup_required"
}
```

#### 403 Cross-site request refused

```json
{
  "error": "Cross-site request refused",
  "code": "bad_origin"
}
```

The `Origin` header is missing, or its host (port included) differs from
`Host`, on:

- `POST /api/auth/setup` and `POST /api/auth/login`, always;
- any POST, PUT, PATCH or DELETE authenticated by the session cookie.

`POST /authorize` answers with an HTML error page instead. Bearer-token requests
are exempt. From curl, add `-H 'Origin: http://localhost:3000'`. Behind a
reverse proxy, forward the original `Host` header; see
[Behind a reverse proxy](/docs/install/#behind-a-reverse-proxy).

#### 429 Too many requests

```json
{
  "error": "Too many login attempts",
  "code": "rate_limited",
  "retryAfter": 842
}
```

The `error` text names what was tried (`Too many setup attempts`,
`Too many token exchange attempts`). A `Retry-After` header gives the same
seconds. Limits count per client IP (per `/64` for IPv6) over 15 minutes from
the first attempt, and reset on restart.

| Endpoint | Allowed per 15 minutes |
| -- | -- |
| `POST /api/auth/login` and signing in on `/authorize` (one shared count) | 10 failed attempts; a successful login resets the count |
| `POST /api/auth/setup` | 10 attempts |
| `POST /api/auth/token` | 30 attempts |

Behind a reverse proxy without `TRUST_PROXY=true`, all clients share one count.

## Endpoints

### GET /healthz

Liveness check, without database access.

```json
{ "ok": true }
```

### GET /api/links

List links, with search and filters.

**Query parameters** (all optional)

| Name | Type | Meaning |
| -- | -- | -- |
| `q` | string | Full-text search over title, URL, note and, once checked, the page's text |
| `hub` | UUID | Only links in this hub |
| `unassigned` | boolean | If true, only links with no hub |
| `status` | string | `active` or `archived`; defaults to `active` |
| `broken` | boolean | If true, only links whose page is gone: the last check got a 404 or 410, or the domain no longer exists |
| `sort` | string | `relevance` (the default: relevance, then most recently seen), `newest`, `oldest` or `title` |
| `limit` | integer | Results per page, 1–200; defaults to 50 |
| `offset` | integer | Pagination offset; defaults to 0 |

**Response**

```json
{
  "items": [
    {
      "id": "uuid",
      "url": "https://example.com",
      "title": "Example Title",
      "note": "User notes",
      "status": "active",
      "relevance": 3,
      "dupeCount": 0,
      "hubIds": ["uuid1", "uuid2"],
      "quoteCount": 2,
      "imageUrl": "https://example.com/og-image.png",
      "httpStatus": 200,
      "checkError": null,
      "broken": false,
      "snippet": null,
      "groupHint": "optional/browser/folder/path",
      "firstSeen": "2024-01-15T10:30:00.000Z"
    }
  ],
  "total": 42
}
```

- `quoteCount`: quotes saved from the link.
- `httpStatus`, `checkError`: from the page's last check; `null` before the first.
- `snippet`: only with `q`, when the page's text matched: about 25 words around
  the match, each matched word between `⸢` (U+2E22) and `⸣` (U+2E23).
- `groupHint` (string or null): the browser folder path or import grouping.
  Not in `POST /api/links` responses.

### GET /api/links/lookup

What bukmark holds for a page and its site. The extension's popup shows this.

**Query parameter:** `url` (string, required), normalized as `POST /api/links`
does: `https://www.Example.com/a?utm_source=x` finds `https://example.com/a`.

**Response**

```json
{
  "saved": { "id": "uuid", "hubs": ["reading", "rust"] },
  "domain": {
    "host": "github.com",
    "links": 12,
    "hubs": [
      { "name": "dev-tools", "links": 9 },
      { "name": "rust", "links": 2 }
    ]
  }
}
```

- `saved`: `null` when the page isn't saved; `"hubs": []` when it is in no hub.
- `domain.links`: other active links on the same host (`www.` ignored,
  subdomains separate). `domain.hubs`: up to three hubs they are in, most links
  first.

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `400` | `{ "error": "unparseable url" }` | The address can't be read |
| `400` | `{ "error": "non-http url" }` | The address isn't http(s) |

### GET /api/links/changes

Links changed or deleted since a time. Bookmark sync pulls this. A change is a
new URL, title, note or status, joining or leaving a hub, or one of its hubs
renamed or archived. Page checks and preview images don't count.

**Query parameters** (all optional)

| Name | Type | Meaning |
| -- | -- | -- |
| `since` | string | An ISO 8601 time with a time zone, normally the `cursor` of an earlier response. Without it you get every link: a first sync. |
| `limit` | integer | Changes per page, 1–1000; defaults to 500 |

**Response**

```json
{
  "items": [
    {
      "id": "uuid",
      "url": "https://example.com/post",
      "title": "Example Title",
      "note": "User notes",
      "status": "active",
      "hubs": ["reading", "rust"],
      "updatedAt": "2026-09-28T10:30:00.123456Z"
    }
  ],
  "deleted": [
    { "id": "uuid", "deletedAt": "2026-09-28T10:31:00.654321Z" }
  ],
  "cursor": "2026-09-28T10:31:00.654321Z",
  "more": false
}
```

- `items`: links changed at or after `since`, archived ones included, oldest
  first. `hubs` leaves out archived hubs.
- `deleted`: links deleted for good at or after `since`. Archiving is a change.
- `cursor`: the time of the last change (UTC, microseconds). Send it back
  unchanged as `since`. It is `null` only on an empty first sync; with nothing
  new, it is `since`.
- `more`: `true` when another page follows.

`since` is inclusive: changes at exactly `since` come back again, so drop the
ones you have. A page never splits changes that share a timestamp, so it can
hold more than `limit`.

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `400` | a schema validation error | `since` is not an ISO 8601 time with a zone, or `limit` is out of range |
| `400` | `{ "error": "invalid since" }` | `since` names a time that doesn't exist, such as 30 February |

### GET /api/links/:id

One link, with everything bukmark holds for it.

**Response**

```json
{
  "id": "uuid",
  "url": "https://example.com/post",
  "title": "Example Title",
  "note": "User notes",
  "status": "active",
  "relevance": 3,
  "dupeCount": 1,
  "imageUrl": null,
  "firstSeen": "2026-09-28T10:30:00.000Z",
  "lastSeen": "2026-09-28T10:30:00.000Z",
  "contentText": "The page's readable text, as of its last successful check…",
  "httpStatus": 404,
  "checkError": null,
  "checkedAt": "2026-09-28T10:31:00.000Z",
  "broken": true,
  "quoteCount": 2,
  "hubIds": ["uuid1"]
}
```

- `contentText`: the page's text from the last check that could read it, up to
  100,000 characters. Kept when a later check finds the page gone.
- `checkError`: why a check got no answer: `dns` (the domain no longer exists),
  `timeout`, `network`, `redirects`, or `blocked` (not a public address, never
  fetched).

**Errors:** `404` with `{ "error": "link not found" }` when there is no such link.

### POST /api/links/check

Check the links most in need of it now: never-checked first, then those checked
over 30 days ago. Archived links are skipped. Each check records the page's
status, keeps its text and fills in a missing preview image. See
`BUKMARK_CHECK_PAGES` in [Install](/docs/install/#environment-variables).

**Body**

```json
{ "limit": 20 }
```

`limit` (integer, optional): 1–50; defaults to 20.

**Response**

```json
{ "processed": 20, "remaining": 1180 }
```

### POST /api/links

Create a link. If the normalized URL already exists, the outcome is `updated` or
`resurrected` instead of `created`.

**Body**

```json
{
  "url": "https://example.com",
  "title": "optional title",
  "note": "optional note",
  "hub": "optional hub name",
  "relevance": 3
}
```

| Name | Type | Meaning |
| -- | -- | -- |
| `url` | string, required | Must be a valid HTTP(S) URL |
| `title` | string, optional | |
| `note` | string, optional | |
| `hub` | string, optional | Hub name to assign on creation. A missing hub is created; an archived one is made active again. |
| `relevance` | integer, optional | Relevance score 1–5 |

**Response**

```json
{
  "outcome": "created",
  "link": {
    "id": "uuid",
    "url": "https://example.com",
    "title": "Example Title",
    "note": "User notes",
    "status": "active",
    "relevance": 3,
    "dupeCount": 0,
    "hubIds": ["uuid"],
    "imageUrl": "https://example.com/og-image.png",
    "firstSeen": "2024-01-15T10:30:00.000Z"
  }
}
```

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `400` | `{ "error": "unparseable url" }` | The URL can't be read |
| `400` | `{ "error": "non-http url" }` | The URL isn't http(s) |

### POST /api/links/import

Import a batch of links. The web app's [file import](/docs/export/#import) and
the extension's **Import all bookmarks** use it. Import creates no hubs. The
body is limited to 4 MiB.

**Body**

```json
{
  "items": [
    {
      "url": "https://example.com",
      "title": "optional title",
      "folderPath": "optional/folder/path",
      "quotes": [
        { "text": "A saved passage.", "note": "optional", "createdAt": "2026-07-01T09:30:00.000Z" }
      ]
    }
  ],
  "orphanQuotes": [
    {
      "text": "A passage from a page that was deleted.",
      "sourceUrl": "https://example.com/gone",
      "sourceTitle": "optional",
      "createdAt": "2026-06-01T09:30:00.000Z"
    }
  ]
}
```

| Name | Type | Meaning |
| -- | -- | -- |
| `items` | array, required | Up to 200 links. May be empty only when `orphanQuotes` is not; a request with neither is a `400` |
| `items[].url` | string, required | |
| `items[].title` | string, optional | |
| `items[].folderPath` | string, optional | Browser folder path, kept as a sorting hint (`groupHint`); never becomes a hub |
| `items[].quotes` | array, optional | Up to 200 quotes for that link. Each is `text` (1–10000 characters), optional `note` (up to 10000 characters), optional `createdAt` (ISO 8601, the quote's saved date). Source address and title are the link's. A text the link already has (ignoring case and extra whitespace) is skipped |
| `orphanQuotes` | array, optional | Up to 1000 quotes that belong to no link, from a [JSON backup](/docs/export/#quotes-in-a-backup). Each is `text`, `sourceUrl` (required), optional `sourceTitle`, `note` and `createdAt`. Skipped when the same `sourceUrl` and text already exist as a quote with no link |

**Response**

```json
{
  "created": 10,
  "updated": 5,
  "skippedDeleted": 2,
  "invalid": [
    {
      "url": "not-a-url",
      "reason": "unparseable url"
    }
  ],
  "quotes": { "added": 4, "alreadyHere": 1, "invalid": 0 }
}
```

- `updated`: existing links; a title already set is kept.
- `skippedDeleted`: links you deleted before, skipped.
- `invalid`: unreadable URLs, with `unparseable url` or `non-http url`.
- `quotes.alreadyHere`: same text on the same page. `quotes.invalid`: blank
  text or an unreadable url. Quotes of a link that stays deleted are kept with
  no link.

### POST /api/links/og-backfill

Look up the preview image (Open Graph image) of links never looked up. Each link
is tried once, found or not.

**Body**

```json
{ "limit": 20 }
```

`limit` (integer, optional): links to look up, 1–50; defaults to 20.

**Response**

```json
{
  "processed": 20,
  "remaining": 45
}
```

`remaining` counts links never attempted.

### POST /api/links/:id/refresh

Re-fetch one link's preview image (og:image) now. The Edit dialog's
**Update preview** button calls this. If none is found, the old image stays.
The title is not touched.

**Body**

```json
{}
```

No body parameters.

**Response**

```json
{
  "id": "uuid",
  "url": "https://example.com",
  "title": "Example Title",
  "note": "User notes",
  "status": "active",
  "relevance": 3,
  "dupeCount": 1,
  "hubIds": ["uuid"],
  "imageUrl": "https://example.com/og-image.png",
  "firstSeen": "2024-01-15T10:30:00.000Z"
}
```

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `404` | `{ "error": "link not found" }` | There is no such link |

### POST /api/links/assign

Assign links to hubs in one request.

**Body**

```json
{
  "assignments": [
    {
      "linkId": "uuid",
      "hub": "Hub Name",
      "relevance": 4
    }
  ]
}
```

| Name | Type | Meaning |
| -- | -- | -- |
| `assignments` | array, required | 1–100 items |
| `assignments[].linkId` | UUID, required | |
| `assignments[].hub` | string, required | Hub name (created if it doesn't exist) |
| `assignments[].relevance` | integer, optional | Relevance score 1–5 |

**Response**

```json
{
  "assigned": 8,
  "hubsCreated": ["New Hub", "Another Hub"],
  "unknownLinkIds": ["00000000-0000-0000-0000-000000000000"]
}
```

`unknownLinkIds` lists link IDs that don't exist.

### PATCH /api/links/:id

Update one link. All fields are optional; they change together or not at all.

**Body**

```json
{
  "title": "new title",
  "note": "new note",
  "status": "archived",
  "relevance": 4,
  "hubs": ["reading", "rust"]
}
```

| Name | Meaning |
| -- | -- |
| `title`, `note` | New text |
| `status` | `active` or `archived` |
| `relevance` | 1–5, or `null` to clear it |
| `hubs` | Up to 100 hub names, replacing the link's hubs. A missing hub is created, an archived one made active again, and `[]` takes the link out of every hub. Archived hubs you leave out keep the link. |
| `addHubs`, `removeHubs` | Up to 100 hub names each, instead of `hubs`. |

`addHubs` adds the link to those hubs (as `hubs` does); `removeHubs` takes it
out of those; other hubs stay. A name in both is added. An archived hub keeps
the link even when named in `removeHubs`. Bookmark sync sends these.

```json
{ "addHubs": ["rust"], "removeHubs": ["reading"] }
```

**Response**

```json
{
  "id": "uuid",
  "url": "https://example.com",
  "title": "Example Title",
  "note": "User notes",
  "status": "active",
  "relevance": 3,
  "dupeCount": 1,
  "hubIds": ["uuid"],
  "imageUrl": "https://example.com/og-image.png",
  "firstSeen": "2024-01-15T10:30:00.000Z"
}
```

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `400` | `{ "error": "hubs cannot be sent with addHubs or removeHubs" }` | `hubs` sent with `addHubs` or `removeHubs` |
| `404` | `{ "error": "link not found" }` | There is no such link |

### POST /api/links/bulk

Apply one action to many links.

**Body**

```json
{
  "ids": ["uuid1", "uuid2"],
  "action": "archive",
  "hubId": "optional-uuid"
}
```

| Name | Type | Meaning |
| -- | -- | -- |
| `ids` | array of UUIDs, required | Link IDs to operate on, at least 1 |
| `action` | string, required | One of the actions below |
| `hubId` | UUID, optional | Required if `action` is `assign` or `unassign` |

| Action | What it does |
| -- | -- |
| `archive` | Mark links as archived |
| `activate` | Mark links as active |
| `assign` | Add links to a hub (requires `hubId`) |
| `unassign` | Remove links from a hub (requires `hubId`) |
| `delete` | Permanently delete links |

**Response**

```json
{
  "affected": 2
}
```

**Errors:** `400` with `{ "error": "assign requires hubId" }` for `assign` or
`unassign` without `hubId` (the message names the action).

### POST /api/quotes

Save a passage from a page. An unsaved page is saved too, unsorted; a saved
page is left as it is, and its seen count doesn't change. The same passage
(ignoring case and extra whitespace) from the same page returns the existing
quote.

**Body**

```json
{
  "url": "https://example.com/article",
  "title": "optional page title",
  "text": "The quoted passage.",
  "note": "optional note"
}
```

| Name | Type | Meaning |
| -- | -- | -- |
| `url` | string, required | The page the passage is from. Only http and https addresses are accepted |
| `text` | string, required | The passage. Trimmed, with its inner line breaks kept, and 1 to 10000 characters after that |
| `title` | string, optional | The page's title, used when the page is not saved yet. A saved page keeps its own title |
| `note` | string, optional | Your note, at most 10000 characters. Default: empty |

**Response:** `201` when the quote was created, `200` when it already existed.

```json
{
  "quote": {
    "id": "uuid",
    "linkId": "uuid",
    "text": "The quoted passage.",
    "note": "",
    "sourceUrl": "https://example.com/article",
    "sourceTitle": "Page title",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "link": { "id": "uuid", "created": true }
}
```

- `sourceUrl`: the normalized address. `sourceTitle`: `title`, or else the
  saved page's title. Both stay with the quote if the link is deleted.
- `linkId`: `null` once the link is deleted.
- `link.created`: `true` when this call saved the page (or brought back a
  deleted one).

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `400` | `{ "error": "unparseable url" }` | The address can't be read |
| `400` | `{ "error": "non-http url" }` | The address isn't http(s) |
| `400` | `{ "error": "quote text is empty" }` | `text` is empty or only whitespace |
| `400` | `{ "error": "quote text is over 10000 characters" }` | `text` is too long |
| `400` | a schema validation error | `url` or `text` is missing, or `note` is over 10000 characters |
| `401` | `unauthenticated` | See [401](#401-unauthenticated) |

### GET /api/quotes

List quotes, newest first, including those whose page was deleted.

| Name | Type | Meaning |
| -- | -- | -- |
| `q` | string, optional | Search the quote text and note, by whole words, as `q` does for links. A quote's page title and address are not searched |
| `linkId` | uuid, optional | Only quotes saved from this link |
| `cursor` | string, optional | The `nextCursor` of the previous page |
| `limit` | integer, optional | 1 to 100, default 50 |

**Response**

```json
{ "items": [ { "id": "uuid", "text": "The quoted passage." } ], "nextCursor": null }
```

Items have the fields shown for `POST /api/quotes`. To page, send `nextCursor`
back unchanged as `cursor`, with the same `q`, `linkId` and `limit`, until it is
`null`.

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `400` | `{ "error": "invalid cursor" }` | `cursor` isn't one this server gave out |
| `400` | a schema validation error | `linkId` isn't a uuid, or `limit` is out of range |
| `401` | `unauthenticated` | See [401](#401-unauthenticated) |

### PATCH /api/quotes/:id

Edit a quote. Send `text`, `note`, or both; `text` follows the rules of
`POST /api/quotes`. Returns `200` with `{ "quote": { … } }`.

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `400` | `{ "error": "send text, note, or both" }` | The body has neither |
| `400` | `{ "error": "quote text is empty" }` or `{ "error": "quote text is over 10000 characters" }` | `text` is not valid |
| `400` | a schema validation error | `id` isn't a uuid, or `note` is over 10000 characters |
| `401` | `unauthenticated` | See [401](#401-unauthenticated) |
| `404` | `{ "error": "not found" }` | No quote has that id |
| `409` | `{ "error": "this page already has a quote with that text" }` | Another quote of the same page already has that text (ignoring case and extra whitespace) |

### DELETE /api/quotes/:id

Delete a quote. Returns `204` with no body.

**Errors:** `400` with a schema validation error when `id` isn't a uuid, `401`
`unauthenticated` ([401](#401-unauthenticated)), or `404` with
`{ "error": "not found" }`.

### GET /api/hubs

List all hubs with their link counts.

**Response**

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Hub Name",
      "description": "Optional description",
      "status": "active",
      "linkCount": 42
    }
  ]
}
```

### POST /api/hubs

Create a hub.

**Body**

```json
{
  "name": "Hub Name",
  "description": "Optional description"
}
```

| Name | Type | Meaning |
| -- | -- | -- |
| `name` | string, required | Must be unique and non-empty |
| `description` | string, optional | |

**Response**

```json
{
  "id": "uuid",
  "name": "Hub Name",
  "description": "Optional description",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Errors:** `409` with `{ "error": "hub name exists" }` when another hub has
this name.

### PATCH /api/hubs/:id

Update a hub. All fields are optional. `status` is `active`, `dormant`, or
`archived`. Renaming or archiving a hub changes each of its links in
[`GET /api/links/changes`](#get-apilinkschanges).

**Body**

```json
{
  "name": "new name",
  "description": "new description",
  "status": "archived"
}
```

**Response**

```json
{
  "id": "uuid",
  "name": "Hub Name",
  "description": "Optional description",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `404` | `{ "error": "hub not found" }` | There is no such hub |
| `409` | `{ "error": "hub name exists" }` | Another hub already has the new name |

### DELETE /api/hubs/:id

Delete a hub. Its links are kept.

**Response**

```json
{
  "ok": true
}
```

**Errors:** `404` with `{ "error": "hub not found" }` when there is no such hub.

### GET /api/stats

Counts: all, active and archived links, hubs, unassigned links, broken links,
active links not yet checked, and quotes (including those of deleted pages).

**Response**

```json
{
  "links": 150,
  "active": 120,
  "archived": 30,
  "hubs": 8,
  "unassigned": 5,
  "broken": 3,
  "unchecked": 40,
  "quotes": 12
}
```

### GET /api/export

Export links as a file: HTML (Netscape bookmark format), JSON or CSV. See
[Import & Export](/docs/export/).

- **JSON:** `{ "version": 1, "exportedAt", "count", "links": [...], "orphanQuotes": [...] }`.
  Each link carries `quotes`, oldest first, as `{ "text", "note", "createdAt" }`.
  `orphanQuotes` holds quotes whose link was deleted, as `{ "text", "note",
  "sourceUrl", "sourceTitle", "createdAt" }`, only in an unfiltered export
  (`status=all`, or the default with no `q`, `hub`, `unassigned` or `broken`);
  otherwise `[]`.
- **HTML:** one `bukmark` folder with a folder per hub, plus `Unsorted` for
  links in no hub.
- HTML and CSV do not include quotes.

**Query parameters**

| Name | Type | Meaning |
| -- | -- | -- |
| `format` | string, required | One of `html`, `json`, `csv` |
| `q` | string, optional | Full-text search filter |
| `hub` | UUID, optional | Only links in this hub |
| `unassigned` | boolean, optional | If true, only links with no hub |
| `broken` | boolean, optional | If true, only links whose page is gone (as `GET /api/links?broken=true`) |
| `status` | string, optional | `active`, `archived`, or `all`; defaults to `active` |

**Response**

A file (`Content-Disposition: attachment`, with its filename) with this
Content-Type:

| `format` | Content-Type |
| -- | -- |
| `html` | `text/html; charset=utf-8` |
| `json` | `application/json; charset=utf-8` |
| `csv` | `text/csv; charset=utf-8` |

The filename is `bukmark-<scope>-<YYYY-MM-DD>.<ext>`, where `<scope>` is:

- the hub name (slugified) if filtering by hub
- `broken` if `broken=true`
- `unsorted` if `unassigned=true`
- `all` otherwise

**Examples** (with a token in `BUKMARK_TOKEN`, see [Start here](#start-here))

```bash
# Export all active links as CSV
curl -f -H "Authorization: Bearer $BUKMARK_TOKEN" "http://localhost:3000/api/export?format=csv" -o links.csv

# Export links in "Resources" hub as HTML
curl -f -H "Authorization: Bearer $BUKMARK_TOKEN" "http://localhost:3000/api/export?format=html&hub=<hub-id>" -o resources.html

# Export unassigned links as JSON
curl -f -H "Authorization: Bearer $BUKMARK_TOKEN" "http://localhost:3000/api/export?format=json&unassigned=true" -o unsorted.json
```

## Authentication endpoints

### GET /api/auth/status

Whether the owner password is set and the request is signed in.

**Response**

```json
{
  "setupComplete": true,
  "authenticated": true,
  "redirectKinds": ["chromium", "firefox", "tab"]
}
```

- `authenticated`: the request's credentials (with a bearer header, the token)
  are valid.
- `redirectKinds`: the `redirect_uri` kinds
  [`/authorize`](#get-authorize-post-authorize) accepts.

### POST /api/auth/setup

Create the owner password on first run. Afterwards it returns `409`. Needs an
`Origin` header whose host matches `Host`
([403](#403-cross-site-request-refused)), and is rate-limited.

**Body**

```json
{
  "password": "your password here"
}
```

`password` (string, required): 12–1024 Unicode characters (an emoji counts
once).

**Response (201)**

```json
{
  "ok": true
}
```

Sets a `bukmark_session` cookie and signs you in.

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `400` | `{ "error": "Password must be 12 to 1024 characters.", "code": "invalid_password" }` | The password is missing, shorter than 12 or longer than 1024 characters |
| `403` | `bad_origin` | See [403](#403-cross-site-request-refused) |
| `409` | `{ "error": "Setup already complete", "code": "already_setup" }` | The owner password is already set |
| `429` | `rate_limited` | After 10 attempts in 15 minutes; see [429](#429-too-many-requests) |

### POST /api/auth/login

Log in with the owner password. Needs an `Origin` header whose host matches
`Host` ([403](#403-cross-site-request-refused)).

**Body**

```json
{
  "password": "your password"
}
```

**Response**

```json
{
  "ok": true
}
```

Sets a `bukmark_session` cookie and signs you in.

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `401` | `{ "error": "Wrong password", "code": "bad_password" }` | The password is wrong |
| `403` | `bad_origin` | See [403](#403-cross-site-request-refused) |
| `409` | `{ "error": "Setup required", "code": "setup_required" }` | No owner password is set yet |
| `429` | `rate_limited` | After 10 failed attempts in 15 minutes; a successful login resets the count. See [429](#429-too-many-requests). |

### POST /api/auth/token

Exchange a one-time code from [`/authorize`](#get-authorize-post-authorize) for
an access token. The extension does this at login; you need it only to write
another client.

**Body**

```json
{
  "grant_type": "authorization_code",
  "code": "<code from the redirect>",
  "code_verifier": "<PKCE verifier>",
  "redirect_uri": "https://<extension-id>.chromiumapp.org/bukmark"
}
```

| Name | Type | Meaning |
| -- | -- | -- |
| `grant_type` | string, required | `authorization_code` |
| `code` | string, required | The `code` that `/authorize` redirected back with; valid once, for 2 minutes |
| `code_verifier` | string, required | The PKCE verifier whose S256 hash was sent as `code_challenge`: 43–128 characters of `A–Z a–z 0–9 - . _ ~` |
| `redirect_uri` | string, required | The same `redirect_uri` the authorization request used |

A login in a tab sends `"redirect_uri": "<server>/authorize/done"`.

**Response**

```json
{
  "token": "bkm_...",
  "tokenId": "123e4567-e89b-12d3-a456-426614174000",
  "name": "bukmark capture"
}
```

The token is named after the request's `client_name` and listed under
**Settings → Access tokens**.

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `400` | `{ "error": "Invalid or expired authorization code", "code": "invalid_grant" }` | Any failure (below) |
| `429` | `rate_limited` | After 30 attempts in 15 minutes; see [429](#429-too-many-requests) |

Every failure gets the same `400`: unknown, used or expired code, wrong
verifier, different `redirect_uri`, or malformed body. The first exchange with
a valid code uses it up, even if the rest is wrong.

### GET /authorize, POST /authorize

The page the extension opens with `chrome.identity.launchWebAuthFlow`:
server-rendered HTML with no JavaScript.

```
GET /authorize?response_type=code&redirect_uri=…&state=…&code_challenge=…&code_challenge_method=S256&client_name=…
```

| Parameter | Value |
| -- | -- |
| `redirect_uri` | Where the code goes, with no query or fragment. One of the three kinds below. |
| `code_challenge` | 43 base64url characters; `code_challenge_method` must be `S256` |
| `state` | 16–256 characters of `A–Z a–z 0–9 - . _ ~`, returned unchanged |
| `client_name` | 1–60 characters, shown as the name of what is asking |

| Kind | `redirect_uri` |
| -- | -- |
| `chromium` | A Chromium extension's redirect URL, `https://<32-letter extension id>.chromiumapp.org/<path>` |
| `firefox` | A Firefox add-on's redirect URL, `https://<40 lowercase hex>.extensions.allizom.org/<path>`, where the hex is the SHA-1 of the add-on ID |
| `tab` | This server's own [`/authorize/done`](#get-authorizedone), exactly `<scheme>://<host>/authorize/done` with the host (and port) this request was sent to; `https` when the request came over HTTPS |

1. An invalid request gets an error page with status `400`, never a redirect.
2. Without a session in this browser, the page asks for the owner password.
3. It names who is asking (the extension ID, the start of the Firefox hash, or
   "the bukmark extension in this browser" for `tab`), with **Allow** and
   **Deny** buttons.
4. Allow redirects with `303` to `redirect_uri?code=…&state=…`; Deny to
   `redirect_uri?error=access_denied&state=…`.

`POST /authorize` receives those forms. It needs a same-host `Origin`, and its
password attempts share the login rate limit (status `429` beyond it).

With `BUKMARK_EXTENSION_IDS` set and the client not in it, or by default for a
Firefox add-on other than the official one, the page shows a warning; nothing
is blocked.

### GET /authorize/done

Where Allow and Deny send a `tab` login (Safari, Firefox for Android). The
extension reads `code` and `state` from its URL and exchanges the code at
[`POST /api/auth/token`](#post-apiauthtoken).

Static HTML with no script or subresources; it never repeats `code` or `state`.
It reads "Access denied — you can close this tab" with `error=access_denied`,
otherwise "Signed in — you can close this tab". Sent with
`Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY` and a `default-src 'none'` Content Security Policy.

The server logs its path without the query. Keep the query out of your proxy's
log too; see [Behind a reverse proxy](/docs/install/#behind-a-reverse-proxy).

### POST /api/auth/logout

Log out: with a session cookie, deletes the session and clears the
`bukmark_session` cookie; with a bearer token, deletes that token.

**Response**

```json
{
  "ok": true
}
```

**Errors:** `401` `unauthenticated` ([401](#401-unauthenticated)).

### GET /api/auth/tokens

List all access tokens, newest first.

**Response**

```json
{
  "items": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "Claude Code",
      "prefix": "bkm_abcd1234",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "lastUsedAt": "2024-01-16T14:22:30.000Z",
      "current": false
    }
  ]
}
```

- `prefix`: the token's first 12 characters.
- `lastUsedAt`: when it last made an API request, or `null`.
- `current`: `true` for the token making this request.

**Errors:** `401` `unauthenticated` ([401](#401-unauthenticated)).

### POST /api/auth/tokens

Create an access token.

**Body**

```json
{
  "name": "My Script"
}
```

`name` (string, required): 1–100 characters, trimmed.

**Response (201)**

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "name": "My Script",
  "prefix": "bkm_abcd1234",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "token": "bkm_abcd1234EFGH5678ijkl9012MNOP3456qrst7890UVW"
}
```

`token` is the full token (47 characters: `bkm_` + 43 base64url characters),
returned only this once. The other fields are as in
[`GET /api/auth/tokens`](#get-apiauthtokens).

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `400` | `{ "error": "Token name must be 1 to 100 characters.", "code": "invalid_name" }` | The name is missing, or is empty or longer than 100 characters after surrounding whitespace is trimmed |
| `401` | `unauthenticated` | See [401](#401-unauthenticated) |
| `409` | `{ "error": "Too many tokens", "code": "too_many_tokens" }` | The server already has 50 tokens, the maximum per instance |

### DELETE /api/auth/tokens/:id

Revoke an access token. `id` is the token's UUID.

**Response**

```json
{
  "ok": true
}
```

**Errors**

| Status | Body | When |
| -- | -- | -- |
| `401` | `unauthenticated` | See [401](#401-unauthenticated) |
| `404` | `{ "error": "Token not found" }` | There is no such token |
