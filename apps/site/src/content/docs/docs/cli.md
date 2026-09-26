---
title: CLI
description: Batch-triage exports from OneTab, Chrome, or Safari using the v0 CLI tool.
sidebar:
  order: 6
---

> **Note:** The CLI is the v0 tool and operates on `data/store.json`, not the Postgres
> database the server uses. For current sorting, use [the MCP server](/docs/sorting).

For bulk-importing a tab dump and having an AI assistant triage it in batches:

```bash
pnpm cli ingest path/to/onetab-export.txt   # parse, normalize, dedupe, junk-filter
pnpm cli prepare                            # → work/batch-N.json
# your AI assistant writes work/batch-N.result.json
pnpm cli merge-triage
pnpm cli render                             # → output/INDEX.md + per-category + junk report
pnpm cli status
```

## Re-ingesting

Re-ingesting the same file is a no-op. To rescue a junked link, add its URL or a
`prefix*` to `data/allow.txt` and re-run `ingest --force`.

## Result Schema

Your AI assistant writes this JSON schema for each batch:

```json
{ "batch": 1, "results": [ { "urlHash": "…", "category": "homelab", "keep": true,
  "relevance": 4, "explanation": "≤120 chars", "reason": "only when keep=false" } ] }
```

## Relevance Scale

- **5** — act now
- **4** — useful reference
- **3** — maybe
- **2** — stale
- **1** — near-junk
