---
title: API reference
description: Every REST endpoint bukmark serves, including the export endpoint.
sidebar:
  order: 5
---

## Authentication

**There is no authentication on any endpoint.** Every endpoint below is reachable
by anything that can reach the port. Use firewall rules or a reverse proxy with
authentication (like Authelia) if you want to restrict access.

## Quick Reference

| Method | Path | Description |
| -- | -- | -- |
| GET | `/healthz` | Liveness check |
| GET | `/api/links` | List links with search and filters |
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

- `q` (string, optional) — Full-text search string
- `hub` (UUID, optional) — Filter to links in this hub
- `unassigned` (boolean, optional) — If true, filter to links with no hub
- `status` (string, optional) — `active` or `archived`; defaults to `active`
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
      "firstSeen": "2024-01-15T10:30:00.000Z"
    }
  ],
  "total": 42
}
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
- `hub` (string, optional) — Hub name to assign on creation
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

**Response:**

Returns the result of all links processed (counts by outcome, or per-item results depending on implementation).

### POST /api/links/og-backfill

Fetch and backfill Open Graph metadata (title, image URL) for links that lack it.

**Request Body:**

```json
{
  "limit": 20
}
```

- `limit` (integer, optional) — Number of links to backfill, 1–50; defaults to 20

**Response:**

Returns the count of links backfilled or error details.

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

**Response:**

Returns confirmation of assignments or per-item results.

### PATCH /api/links/:id

Update title, note, or status of a single link.

**Path Parameters:**

- `id` (UUID, required) — Link ID

**Request Body:**

```json
{
  "title": "new title",
  "note": "new note",
  "status": "archived"
}
```

- All fields optional
- `status`: `active` or `archived`

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

Get aggregate counts: total links, active links, archived links, hub count, and unassigned link count.

**Response:**

```json
{
  "links": 150,
  "active": 120,
  "archived": 30,
  "hubs": 8,
  "unassigned": 5
}
```

### GET /api/export

Export links as HTML (Netscape bookmark format), JSON, or CSV. The response
includes a `Content-Disposition: attachment` header with a filename.

**Query Parameters:**

- `format` (string, required) — One of `html`, `json`, `csv`
- `q` (string, optional) — Full-text search filter
- `hub` (UUID, optional) — Filter to links in this hub
- `unassigned` (boolean, optional) — If true, filter to links with no hub
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

```bash
# Export all active links as CSV
curl "http://localhost:3000/api/export?format=csv" -o links.csv

# Export links in "Resources" hub as HTML
curl "http://localhost:3000/api/export?format=html&hub=<hub-id>" -o resources.html

# Export unassigned links as JSON
curl "http://localhost:3000/api/export?format=json&unassigned=true" -o unsorted.json
```
