---
title: CLI
description: Batch-triage a OneTab export using the v0 CLI tool.
sidebar:
  order: 8
---

The v0 CLI imports a tab dump and has an AI assistant triage it in batches. The
result in `output/` is the links you kept, ranked, a page per category.

:::note
The CLI works on `data/store.json`, not the server's database. To sort your
bukmark server, use [the MCP server](/docs/sorting).
:::

## Triage a tab dump

1. Ingest the export (parse, normalize, dedupe, filter junk):

   ```bash
   pnpm cli ingest path/to/onetab-export.txt
   ```

2. Prepare batches (`work/batch-N.json`):

   ```bash
   pnpm cli prepare
   ```

3. Have your AI assistant write `work/batch-N.result.json` for each batch
   ([result schema](#result-schema)).

4. Merge the results:

   ```bash
   pnpm cli merge-triage
   ```

5. Render `output/INDEX.md`, a page per category and a junk report:

   ```bash
   pnpm cli render
   ```

`pnpm cli status` shows kept, tossed, junk and pending counts.

## Result schema

```json
{ "batch": 1, "results": [ { "urlHash": "…", "category": "homelab", "keep": true,
  "relevance": 4, "explanation": "≤120 chars", "reason": "only when keep=false" } ] }
```

### Relevance scale

| `relevance` | Means |
| -- | -- |
| **5** | act now |
| **4** | useful reference |
| **3** | maybe |
| **2** | stale |
| **1** | near-junk |

## Re-ingesting

Re-ingesting the same file changes nothing. To rescue a junked link, add its URL
or a `prefix*` to `data/allow.txt` and run `ingest --force`.
