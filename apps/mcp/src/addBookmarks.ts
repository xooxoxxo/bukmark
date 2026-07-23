export interface BookmarkItem {
  url: string;
  title?: string;
  note?: string;
  hub?: string;
  relevance?: number;
}

export interface ItemResult {
  url: string;
  outcome?: 'created' | 'updated' | 'resurrected';
  error?: string;
}

export function toRequestBody(item: BookmarkItem): Record<string, unknown> {
  const body: Record<string, unknown> = { url: item.url };
  if (item.title !== undefined) body.title = item.title;
  if (item.note !== undefined) body.note = item.note;
  if (item.hub !== undefined) body.hub = item.hub;
  if (item.relevance !== undefined) body.relevance = item.relevance;
  return body;
}

export function summarize(results: ItemResult[]): string {
  const n = { created: 0, updated: 0, resurrected: 0, failed: 0 };
  const lines = results.map((r) => {
    if (r.error) {
      n.failed += 1;
      return `${r.url} → error: ${r.error}`;
    }
    if (r.outcome) n[r.outcome] += 1;
    return `${r.url} → ${r.outcome}`;
  });
  const totals = `${n.created} created, ${n.updated} updated, ${n.resurrected} resurrected, ${n.failed} failed`;
  return `${totals}\n${lines.join('\n')}`;
}
