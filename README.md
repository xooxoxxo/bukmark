# bookmarkt

Tab-dump triage pipeline. Ingest OneTab exports, dedupe, junk-filter,
Claude-triage, render ranked markdown.

## Loop (per file drop)

    pnpm cli ingest path/to/onetab-export.txt
    pnpm cli prepare            # writes work/batch-N.json
    # → Claude session triages batches → work/batch-N.result.json
    pnpm cli merge-triage
    pnpm cli render             # output/INDEX.md + per-category + junk report
    pnpm cli status

Re-ingesting the same file is a no-op. New files merge; re-render anytime.

## Salvage a junked link

Add exact URL or `prefix*` to `data/allow.txt`, re-run ingest with `--force`.

## Result file schema (what Claude writes)

    { "batch": 1, "results": [ { "urlHash": "…", "category": "homelab",
      "keep": true, "relevance": 4, "explanation": "≤120 chars", "reason": "only when keep=false" } ] }

Relevance: 5 act now · 4 useful reference · 3 maybe · 2 stale · 1 near-junk.
