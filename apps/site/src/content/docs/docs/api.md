---
title: API reference
description: Every REST endpoint bukmark serves, including the export endpoint.
sidebar:
  order: 6
---

## Authentication

Every `/api` endpoint needs credentials except the public ones listed below:
either the session cookie the web app gets when you sign in, or an access token
sent as a bearer token. Without them the server answers `401`.

### Public endpoints

These need no credentials:

- `GET /healthz` — liveness check
- `GET /api/auth/status` — whether the server is set up, and whether this request is signed in
- `POST /api/auth/setup` — create the owner password (first run only)
- `POST /api/auth/login` — sign in with the owner password
- `POST /api/auth/token` — exchange an authorization code for an access token (the browser extension's login)
- `GET /authorize`, `POST /authorize` — the sign-in and Allow page the extension
  opens in a window (authorization code flow with PKCE, `S256` only); an HTML
  page for people, not a JSON API
- `GET /authorize/done` — where a login in a browser tab lands; a static HTML page

Setup, login and `POST /authorize` also require a same-host `Origin` header
([403](#403-cross-site-request-refused)), and they are rate-limited along with
the token exchange ([429](#429-too-many-requests)).

### Bearer tokens

Create a token in the web app under **Settings → Access tokens** and send it in
the `Authorization` header:

```bash
curl -H "Authorization: Bearer $BUKMARK_TOKEN" http://localhost:3000/api/links
```

A token is valid only on the server that issued it. A request that carries a
bearer header is judged by that token alone — a valid session cookie next to a
wrong token does not help — and a revoked token gets `401` with
`unauthenticated`.

### Session cookies

`POST /api/auth/setup` and `POST /api/auth/login` set a `bukmark_session`
cookie. A session lasts 30 days and is extended when used, at most once a day.
The cookie is:

- `HttpOnly` (not readable by JavaScript)
- `Path=/` (sent to all routes)
- `SameSite=Lax` (not sent on cross-site POSTs, but sent on navigations from links)
- `Secure` only when the request arrived over HTTPS — behind a proxy that
  terminates TLS, the server can tell only with `TRUST_PROXY=true`. On
  plain-HTTP installs the cookie is sent without it, so logging in over a LAN
  or tailnet address works.
- `Max-Age=2592000` (30 days)

A POST, PUT, PATCH or DELETE authenticated by the cookie must also carry a
matching `Origin` header; browsers send it on their own.

### Error responses

#### 401 Unauthenticated

Returned when no valid credentials are provided, or the token or session has
expired or been revoked.

```json
{
  "error": "Not authenticated",
  "code": "unauthenticated"
}
```

The `error` text names the cause (`Invalid token`, `Session expired`); match on
`code`.

#### 401 Setup required

Returned by every protected endpoint until the owner password is set (first
run). Open the web app to set it.

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

Returned when the `Origin` header is missing, or its host (port included)
differs from the `Host` header, on:

- `POST /api/auth/setup` and `POST /api/auth/login`, always;
- any POST, PUT, PATCH or DELETE authenticated by the session cookie.

`POST /authorize` makes the same check and answers with an HTML error page.
Requests authenticated by a bearer token are exempt. Browsers send `Origin`
themselves; from curl or a script, add it, for example
`-H 'Origin: http://localhost:3000'`. Behind a reverse proxy, the proxy must
forward the original `Host` header or every browser sign-in gets this error —
see [Behind a reverse proxy](/docs/install/#behind-a-reverse-proxy).

#### 429 Too many requests

```json
{
  "error": "Too many login attempts",
  "code": "rate_limited",
  "retryAfter": 842
}
```

The response also carries a `Retry-After` header with the same number of
seconds. Limits count per client IP (per `/64` for IPv6) over a 15-minute
window that starts with the first attempt, and live in memory, so a restart
clears them:

| Endpoint | Allowed per 15 minutes |
| -- | -- |
| `POST /api/auth/login` and signing in on `/authorize` (one shared count) | 10 failed attempts; a successful login resets the count |
| `POST /api/auth/setup` | 10 attempts |
| `POST /api/auth/token` | 30 attempts |

Behind a reverse proxy the server sees the proxy's address for every client
unless `TRUST_PROXY=true`, so all clients share one count.

## Quick Reference

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
| POST | `/api/links/og-backfill` | Backfill missing Open Graph metadata |
| POST | `/api/links/assign` | Assign links to hubs in bulk |
| PATCH | `/api/links/:id` | Update a single link |
| POST | `/api/links/bulk` | Archive, activate, assign, or delete links |
| GET | `/api/hubs` | List all hubs |
| POST | `/api/hubs` | Create a hub |
| PATCH | `/api/hubs/:id` | Update a hub |
| DELETE | `/api/hubs/:id` | Delete a hub |
| GET | `/api/stats` | Get link and hub counts |
| GET | `/api/export` | Export links as HTML, JSON, or CSV |

## Endpoints

### GET /healthz

Liveness check. Returns immediately with no database access.

**Response:**

```json
{
  "ok": true
}
```

### GET /api/links

List links with optional full-text search, hub filtering, and status filtering.

**Query Parameters:**

- `q` (string, optional) — Full-text search. It matches the title, URL and note,
  and the text of the page itself once the page has been checked.
- `hub` (UUID, optional) — Filter to links in this hub
- `unassigned` (boolean, optional) — If true, filter to links with no hub
- `status` (string, optional) — `active` or `archived`; defaults to `active`
- `broken` (boolean, optional) — If true, only links whose page is gone: the
  last check got a 404 or 410, or the domain no longer exists
- `sort` (string, optional) — `relevance` (the default: relevance, then most
  recently seen), `newest`, `oldest` or `title`
- `limit` (integer, optional) — Results per page, 1–200; defaults to 50
- `offset` (integer, optional) — Pagination offset; defaults to 0

**Response:**

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

`httpStatus` and `checkError` come from the page's last check (both `null`
until the first). `snippet` is set only with `q`, and only when the words
matched inside the page's text: about 25 words around the match, with each
matched word between `⸢` (U+2E22) and `⸣` (U+2E23).

**Note:** The `groupHint` field (string or null) represents the browser bookmark folder path or import source grouping. It is included in `GET /api/links` responses but omitted from `POST /api/links` responses due to response schema validation.

### GET /api/links/lookup

What bukmark already holds for a page, before saving it: the page itself and
the hubs it is in, and how the rest of its site is filed. The extension's popup
shows this above the save form.

**Query Parameters:**

- `url` (string, required) — The page's address. It is normalized the way
  `POST /api/links` normalizes it, so `https://www.Example.com/a?utm_source=x`
  finds `https://example.com/a`.

**Response:**

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

- `saved` is `null` when the page isn't saved. A saved page in no hub has
  `"hubs": []`.
- `domain.links` counts the other active links with the same host (a leading
  `www.` is ignored; subdomains count separately). `domain.hubs` names up to
  three hubs they are in, most links first.

**Errors:** `400` with `{ "error": "unparseable url" }` or
`{ "error": "non-http url" }` when the address can't be read or isn't http(s).

### GET /api/links/changes

The links that changed since a given time, and the links deleted since then.
The extension's bookmark sync pulls this. A link counts as changed when its
URL, title, note or status changes, when it joins or leaves a hub, and when one
of its hubs is renamed or archived. Page checks and preview images don't count.

**Query Parameters:**

- `since` (string, optional) — An ISO 8601 time with a time zone, normally the
  `cursor` of an earlier response. Without it you get every link: a first sync.
- `limit` (integer, optional) — Changes per page, 1–1000; defaults to 500

**Response:**

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

- `items` — links changed at or after `since`, archived ones included, oldest
  first. `hubs` names the hubs the link is in, leaving out archived hubs.
- `deleted` — links deleted for good at or after `since` (archiving is a change,
  not a deletion).
- `cursor` — the time of the last change in the response. Send it back as
  `since` for the next page or the next sync. It is `null` only on a first sync
  with nothing to return; with nothing new, it is `since`.
- `more` — `true` when another page follows now.

Times are UTC with microseconds. Pass `cursor` back as it is: cut to
milliseconds, it sends changes again; rounded up, it can skip some.

`since` is inclusive. Changes stamped exactly at `since` come back again, so
writes that share a timestamp are never lost between two pulls; drop the ones
you already have. A page never splits changes that share a timestamp, and the
ones at `since` don't count toward `limit`, so a page can hold more than `limit`.

A change made in a transaction that is still open when you pull waits for the
next pull, so the cursor never moves past a write that has yet to appear.

**Errors:** `400` when `since` is not an ISO 8601 time with a zone or `limit`
is out of range, and `{ "error": "invalid since" }` when `since` names a time
that doesn't exist, such as 30 February.

### GET /api/links/:id

One link, with everything bukmark holds for it.

**Response:**

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
  "hubIds": ["uuid1"]
}
```

`contentText` is the page's text from the last check that could read it, up to
100,000 characters; a later check that finds the page gone keeps it. `checkError`
says why a check got no answer: `dns` (the domain no longer exists), `timeout`,
`network`, `redirects`, or `blocked` (the address is not public, so it is never
fetched). `404` when there is no such link.

### POST /api/links/check

Checks the links most in need of it — never-checked first, then those last
checked over 30 days ago — instead of waiting for the background checks
(see `BUKMARK_CHECK_PAGES` in [Install](/docs/install/#environment-variables)).
Each check records the page's status, keeps its readable text, and fills in a
missing preview image. Archived links are never checked.

**Request Body:**

```json
{ "limit": 20 }
```

- `limit` (integer, optional) — 1–50; defaults to 20

**Response:**

```json
{ "processed": 20, "remaining": 1180 }
```

### POST /api/links

Create a new link or update an existing one. If the URL is normalized to an
existing link, returns an `updated` or `resurrected` outcome instead of `created`.

**Request Body:**

```json
{
  "url": "https://example.com",
  "title": "optional title",
  "note": "optional note",
  "hub": "optional hub name",
  "relevance": 3
}
```

- `url` (string, required) — Must be a valid HTTP(S) URL
- `title` (string, optional)
- `note` (string, optional)
- `hub` (string, optional) — Hub name to assign on creation. A missing hub is
  created; an archived one is made active again.
- `relevance` (integer, optional) — Relevance score 1–5

**Response (200):**

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

- `outcome`: `created`, `updated`, or `resurrected`

**Response (400):**

```json
{
  "error": "invalid url"
}
```

### POST /api/links/import

Import a batch of links, typically from a bookmark export (HTML, JSON, CSV).

**Request Body:**

```json
{
  "items": [
    {
      "url": "https://example.com",
      "title": "optional title",
      "folderPath": "optional/folder/path"
    }
  ]
}
```

- `items` (array, required, 1–200 items) — Array of links to import
  - `url` (string, required)
  - `title` (string, optional)
  - `folderPath` (string, optional) — Browser bookmark folder path; becomes a hub if it doesn't exist

**Response (200):**

```json
{
  "created": 10,
  "updated": 5,
  "skippedDeleted": 2,
  "invalid": [
    {
      "url": "not-a-url",
      "reason": "invalid url"
    }
  ]
}
```

- `created` (integer) — Number of new links created
- `updated` (integer) — Number of existing links updated (same URL, title preserved if already set)
- `skippedDeleted` (integer) — Number of URLs that were previously deleted and skipped on reimport
- `invalid` (array) — URLs that could not be normalized, with reason for each

### POST /api/links/og-backfill

Fetch and backfill Open Graph metadata (title, image URL) for links that lack it.

**Request Body:**

```json
{
  "limit": 20
}
```

- `limit` (integer, optional) — Number of links to backfill, 1–50; defaults to 20

**Response (200):**

```json
{
  "processed": 20,
  "remaining": 45
}
```

- `processed` (integer) — Number of links fetched for Open Graph metadata in this call
- `remaining` (integer) — Total number of links still waiting for backfill (those that have never been attempted)

### POST /api/links/assign

Assign multiple links to hubs in a single request.

**Request Body:**

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

- `assignments` (array, required, 1–100 items)
  - `linkId` (UUID, required)
  - `hub` (string, required) — Hub name (created if doesn't exist)
  - `relevance` (integer, optional) — Relevance score 1–5

**Response (200):**

```json
{
  "assigned": 8,
  "hubsCreated": ["New Hub", "Another Hub"],
  "unknownLinkIds": ["00000000-0000-0000-0000-000000000000"]
}
```

- `assigned` (integer) — Number of link-to-hub assignments that succeeded
- `hubsCreated` (string array) — Names of hubs that were created during this call (did not exist before)
- `unknownLinkIds` (string array) — Link IDs from the request that do not exist in the database

### PATCH /api/links/:id

Update the title, note, status, relevance or hubs of a single link.

**Path Parameters:**

- `id` (UUID, required) — Link ID

**Request Body:**

```json
{
  "title": "new title",
  "note": "new note",
  "status": "archived",
  "relevance": 4,
  "hubs": ["reading", "rust"]
}
```

- All fields optional; they change together or not at all
- `status`: `active` or `archived`
- `relevance`: 1–5, or `null` to clear it
- `hubs`: up to 100 hub names. They replace the hubs the link is in: a missing
  hub is created, an archived one is made active again, and `[]` takes the link
  out of every hub. Archived hubs you leave out keep the link, since sync never
  shows them.
- `addHubs`, `removeHubs`: up to 100 hub names each, instead of `hubs`. The link
  goes into the first (created or made active as with `hubs`) and out of the
  second, and stays in every other hub. A name in both ends up added. An
  archived hub keeps the link even when named in `removeHubs`, as archiving a
  hub keeps its links. Bookmark sync sends these, so that a hub the link got on
  the server since the browser's last sync is kept.

```json
{ "addHubs": ["rust"], "removeHubs": ["reading"] }
```

**Response (200):**

```json
{
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
```

**Response (400):** `hubs` sent with `addHubs` or `removeHubs`.

```json
{
  "error": "hubs cannot be sent with addHubs or removeHubs"
}
```

**Response (404):**

```json
{
  "error": "link not found"
}
```

### POST /api/links/bulk

Apply an action (archive, activate, assign, unassign, delete) to multiple links
in a single request.

**Request Body:**

```json
{
  "ids": ["uuid1", "uuid2"],
  "action": "archive",
  "hubId": "optional-uuid"
}
```

- `ids` (array of UUIDs, required, at least 1) — Link IDs to operate on
- `action` (string, required) — One of:
  - `archive` — Mark links as archived
  - `activate` — Mark links as active
  - `assign` — Add links to a hub (requires `hubId`)
  - `unassign` — Remove links from a hub (requires `hubId`)
  - `delete` — Permanently delete links
- `hubId` (UUID, optional) — Required if `action` is `assign` or `unassign`

**Response (200):**

```json
{
  "affected": 2
}
```

**Response (400):**

```json
{
  "error": "assign requires hubId"
}
```

### GET /api/hubs

List all hubs with their link counts.

**Response:**

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

Create a new hub.

**Request Body:**

```json
{
  "name": "Hub Name",
  "description": "Optional description"
}
```

- `name` (string, required) — Must be unique and non-empty
- `description` (string, optional)

**Response (200):**

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

**Response (409):**

```json
{
  "error": "hub name exists"
}
```

### PATCH /api/hubs/:id

Update a hub's name, description, or status.

**Path Parameters:**

- `id` (UUID, required) — Hub ID

**Request Body:**

```json
{
  "name": "new name",
  "description": "new description",
  "status": "archived"
}
```

- All fields optional
- `status`: `active`, `dormant`, or `archived`

Renaming or archiving a hub counts as a change to each of its links in
[`GET /api/links/changes`](#get-apilinkschanges).

**Response (200):**

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

**Response (404):**

```json
{
  "error": "hub not found"
}
```

**Response (409):** when another hub already has the new name.

```json
{
  "error": "hub name exists"
}
```

### DELETE /api/hubs/:id

Delete a hub. This does not delete the links in it.

**Path Parameters:**

- `id` (UUID, required) — Hub ID

**Response (200):**

```json
{
  "ok": true
}
```

**Response (404):**

```json
{
  "error": "hub not found"
}
```

### GET /api/stats

Get aggregate counts: total links, active links, archived links, hub count,
unassigned links, broken links, and active links not yet checked.

**Response:**

```json
{
  "links": 150,
  "active": 120,
  "archived": 30,
  "hubs": 8,
  "unassigned": 5,
  "broken": 3,
  "unchecked": 40
}
```

### GET /api/export

Export links as HTML (Netscape bookmark format), JSON, or CSV. The response
includes a `Content-Disposition: attachment` header with a filename.

The HTML file holds one `bukmark` folder with a folder per hub inside, plus
`Unsorted` for links in no hub: the layout bookmark sync keeps in the browser.

**Query Parameters:**

- `format` (string, required) — One of `html`, `json`, `csv`
- `q` (string, optional) — Full-text search filter
- `hub` (UUID, optional) — Filter to links in this hub
- `unassigned` (boolean, optional) — If true, filter to links with no hub
- `broken` (boolean, optional) — If true, only links whose page is gone (as `GET /api/links?broken=true`)
- `status` (string, optional) — `active`, `archived`, or `all`; defaults to `active`

**Response:**

Returns a file attachment with Content-Type set to:
- `text/html; charset=utf-8` for format=html
- `application/json; charset=utf-8` for format=json
- `text/csv; charset=utf-8` for format=csv

**Filename Format:**

`bukmark-<scope>-<YYYY-MM-DD>.<ext>`

Where `<scope>` is:
- The hub name (slugified) if filtering by hub
- `unsorted` if `unassigned=true`
- `all` otherwise

**Example:**

These need an access token (**Settings → Access tokens**) in `BUKMARK_TOKEN`.
`-f` makes curl fail on an error status instead of writing the error body into
the file.

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

Check whether the server has a configured owner and whether the current request is authenticated.

**Response (200):**

```json
{
  "setupComplete": true,
  "authenticated": true,
  "redirectKinds": ["chromium", "firefox", "tab"]
}
```

- `setupComplete` (boolean) — Whether the owner password has been set
- `authenticated` (boolean) — Whether the request has valid credentials. With
  an `Authorization: Bearer` header, whether that token is valid — the
  extension checks a pasted token this way.
- `redirectKinds` (string array) — the kinds of `redirect_uri`
  [`/authorize`](#get-authorize-post-authorize) accepts. The extension calls
  this endpoint before it opens a login window, and asks you to update the
  server when the kind it needs is missing.

### POST /api/auth/setup

Create the owner password on first run. This endpoint is public until the owner
is set; afterward it returns 409. Like login, it needs an `Origin` header whose
host matches `Host` (browsers send it; with curl add
`-H 'Origin: http://localhost:3000'`) and is rate-limited.

**Request Body:**

```json
{
  "password": "your password here"
}
```

- `password` (string, required) — 12–1024 characters

**Response (201):**

```json
{
  "ok": true
}
```

Sets a `bukmark_session` cookie and signs in the user who set the password.

**Response (400):** the password is missing, shorter than 12 or longer than 1024
characters. Length is counted in Unicode characters, so an emoji counts once.

```json
{
  "error": "Password must be 12 to 1024 characters.",
  "code": "invalid_password"
}
```

**Response (403):** `bad_origin` — see [403](#403-cross-site-request-refused).

**Response (409):**

```json
{
  "error": "Setup already complete",
  "code": "already_setup"
}
```

**Response (429):** `rate_limited` after 10 attempts in 15 minutes — see
[429](#429-too-many-requests).

### POST /api/auth/login

Log in with the owner password. Needs an `Origin` header whose host matches
`Host` (browsers send it; with curl add `-H 'Origin: http://localhost:3000'`).

**Request Body:**

```json
{
  "password": "your password"
}
```

**Response (200):**

```json
{
  "ok": true
}
```

Sets a `bukmark_session` cookie and signs in the user.

**Response (401):**

```json
{
  "error": "Wrong password",
  "code": "bad_password"
}
```

**Response (403):** `bad_origin` — see [403](#403-cross-site-request-refused).

**Response (409):**

```json
{
  "error": "Setup required",
  "code": "setup_required"
}
```

**Response (429):** `rate_limited` after 10 failed attempts in 15 minutes; a
successful login resets the count — see [429](#429-too-many-requests).

### POST /api/auth/token

Exchange a one-time authorization code from [`/authorize`](#get-authorize-post-authorize)
for an access token. The browser extension does this when you log in; you only
need it to write another client.

**Request Body:**

```json
{
  "grant_type": "authorization_code",
  "code": "<code from the redirect>",
  "code_verifier": "<PKCE verifier>",
  "redirect_uri": "https://<extension-id>.chromiumapp.org/bukmark"
}
```

The same exchange serves every [redirect kind](#get-authorize-post-authorize):
a login in a tab sends `"redirect_uri": "<server>/authorize/done"`.

- `grant_type` (string, required) — `authorization_code`
- `code` (string, required) — the `code` that `/authorize` redirected back with;
  valid once, for 2 minutes
- `code_verifier` (string, required) — the PKCE verifier whose S256 hash was sent
  as `code_challenge`: 43–128 characters of `A–Z a–z 0–9 - . _ ~`
- `redirect_uri` (string, required) — the same `redirect_uri` the authorization
  request used

**Response (200):**

```json
{
  "token": "bkm_...",
  "tokenId": "123e4567-e89b-12d3-a456-426614174000",
  "name": "bukmark capture"
}
```

The token is named after the authorization request's `client_name` and appears
under **Settings → Access tokens** like any other.

**Response (400):**

```json
{
  "error": "Invalid or expired authorization code",
  "code": "invalid_grant"
}
```

Every failure gets this same answer — unknown, used or expired code, wrong
verifier, different `redirect_uri`, malformed body — so a failed exchange does
not reveal which part was wrong. The first exchange that presents a valid code
uses it up, even if its verifier or `redirect_uri` is wrong.

**Response (429):** `rate_limited` after 30 attempts in 15 minutes — see
[429](#429-too-many-requests).

### GET /authorize, POST /authorize

The page the extension opens with `chrome.identity.launchWebAuthFlow`:
server-rendered HTML with no JavaScript, not a JSON API.

```
GET /authorize?response_type=code&redirect_uri=…&state=…&code_challenge=…&code_challenge_method=S256&client_name=…
```

- `redirect_uri` — where the code goes, with no query or fragment. One of:
  - `chromium` — a Chromium extension's redirect URL,
    `https://<32-letter extension id>.chromiumapp.org/<path>`
  - `firefox` — a Firefox add-on's redirect URL,
    `https://<40 lowercase hex>.extensions.allizom.org/<path>`, where the hex is
    the SHA-1 of the add-on ID
  - `tab` — this server's own [`/authorize/done`](#get-authorizedone), exactly
    `<scheme>://<host>/authorize/done` with the host (and port) this request
    was sent to; `https` when the request came over HTTPS
- `code_challenge` — 43 base64url characters; `code_challenge_method` must be `S256`
- `state` — 16–256 characters of `A–Z a–z 0–9 - . _ ~`, returned unchanged
- `client_name` — 1–60 characters, shown as the name of what is asking

An invalid request gets an error page with status `400` and is never
redirected. Otherwise the page asks for the owner password if this browser has
no session, then says who is asking — the extension ID, the start of the
Firefox hash, or "the bukmark extension in this browser" for a `tab` redirect —
with **Allow** and **Deny** buttons. When the server has
`BUKMARK_EXTENSION_IDS` set (Chrome IDs and Firefox hashes, comma-separated)
and the client is not in it, or by default for a Firefox add-on other than the
official one, both pages add a warning; nothing is blocked.
`POST /authorize` receives those forms. It needs a same-host `Origin` (the
browser sends it), and its password attempts share the login rate limit
(beyond it, the page comes back with status `429`). Allow redirects with `303`
to `redirect_uri?code=…&state=…`, and Deny to
`redirect_uri?error=access_denied&state=…`.

### GET /authorize/done

Where Allow and Deny send a login whose `redirect_uri` is of the `tab` kind:
browsers without an extension login window (Safari, Firefox for Android) open
`/authorize` in an ordinary tab, and the extension reads `code` and `state`
from this page's URL, then exchanges the code at
[`POST /api/auth/token`](#post-apiauthtoken).

The page is static HTML with no script or subresources, and never repeats
`code` or `state`. With `error=access_denied` it reads "Access denied — you can
close this tab"; otherwise "Signed in — you can close this tab". It is sent
with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY` and a `default-src 'none'` Content Security Policy, and
the server logs its path without the query. A reverse proxy in front of it logs
the query too unless told not to — see
[Behind a reverse proxy](/docs/install/#behind-a-reverse-proxy).

### POST /api/auth/logout

Log out and invalidate the session cookie or token.

**Response (200):**

```json
{
  "ok": true
}
```

- If using a session cookie: deletes the session and clears the `bukmark_session` cookie.
- If using a bearer token: deletes that token from the database.

**Response (401):**

```json
{
  "error": "Not authenticated",
  "code": "unauthenticated"
}
```

### GET /api/auth/tokens

List all access tokens, newest first.

**Response (200):**

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

- `id` (UUID) — Token ID, used for revocation
- `name` (string) — Token name (e.g., "Claude Code", "bukmark capture")
- `prefix` (string) — First 12 characters of the token (for identification)
- `createdAt` (ISO string) — When the token was created
- `lastUsedAt` (ISO string or null) — Last time this token was used for an API request
- `current` (boolean) — True if this token made the current request

**Response (401):**

```json
{
  "error": "Not authenticated",
  "code": "unauthenticated"
}
```

### POST /api/auth/tokens

Create a new access token.

**Request Body:**

```json
{
  "name": "My Script"
}
```

- `name` (string, required) — 1–100 characters, trimmed

**Response (201):**

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "name": "My Script",
  "prefix": "bkm_abcd1234",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "token": "bkm_abcd1234EFGH5678ijkl9012MNOP3456qrst7890UVW"
}
```

**Important:** The plaintext `token` is returned only once. Save it immediately.

- `id`, `name`, `prefix`, `createdAt` — As documented in GET /api/auth/tokens
- `token` (string) — The full token (47 characters: `bkm_` + 43 base64url chars)

**Response (400):** the name is missing, or is empty or longer than 100
characters after surrounding whitespace is trimmed:

```json
{
  "error": "Token name must be 1 to 100 characters.",
  "code": "invalid_name"
}
```

**Response (401):**

```json
{
  "error": "Not authenticated",
  "code": "unauthenticated"
}
```

**Response (409):**

```json
{
  "error": "Too many tokens",
  "code": "too_many_tokens"
}
```

Maximum 50 tokens per instance.

### DELETE /api/auth/tokens/:id

Revoke an access token by ID.

**Path Parameters:**

- `id` (UUID, required) — Token ID

**Response (200):**

```json
{
  "ok": true
}
```

**Response (401):**

```json
{
  "error": "Not authenticated",
  "code": "unauthenticated"
}
```

**Response (404):**

```json
{
  "error": "Token not found"
}
```
