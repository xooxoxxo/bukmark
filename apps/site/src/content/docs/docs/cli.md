---
title: CLI
description: Batch-triage a OneTab export using the v0 CLI tool.
sidebar:
  order: 7
---

The v0 CLI bulk-imports a tab dump and has an AI assistant triage it in
batches. At the end, `output/` holds the links you kept, ranked, a page per
category.

:::note
The CLI is the v0 tool and operates on `data/store.json`, not the Postgres
database the server uses. For current sorting, use [the MCP server](/docs/sorting).
:::

## Triage a tab dump

1. Ingest the export: parse, normalize, dedupe, junk-filter.

   ```bash
   pnpm cli ingest path/to/onetab-export.txt
   ```

2. Prepare batches: `work/batch-N.json`.

   ```bash
   pnpm cli prepare
   ```

3. Have your AI assistant write `work/batch-N.result.json` for each batch
   ([result schema](#result-schema)).

4. Merge the results.

   ```bash
   pnpm cli merge-triage
   ```

5. Render `output/INDEX.md`, a page per category and a junk report.

   ```bash
   pnpm cli render
   ```

`pnpm cli status` counts kept, tossed, junk and pending links at any point, and
the result files still waiting to be merged.

## Result Schema

Your AI assistant writes this JSON schema for each batch:

```json
{ "batch": 1, "results": [ { "urlHash": "…", "category": "homelab", "keep": true,
  "relevance": 4, "explanation": "≤120 chars", "reason": "only when keep=false" } ] }
```

### Relevance Scale

| `relevance` | Means |
| -- | -- |
| **5** | act now |
| **4** | useful reference |
| **3** | maybe |
| **2** | stale |
| **1** | near-junk |

## Re-ingesting

Re-ingesting the same file is a no-op. To rescue a junked link, add its URL or a
`prefix*` to `data/allow.txt` and re-run `ingest --force`.
