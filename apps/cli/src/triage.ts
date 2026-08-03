import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Canon, Store, Triage } from '@bukmark/shared';

export interface BatchLink {
  urlHash: string;
  url: string;
  title: string;
  dupeCount: number;
  groupHints: string[];
}

export interface TriageResultEntry {
  urlHash: string;
  category: string;
  keep: boolean;
  relevance: number;
  explanation: string;
  reason?: string;
}

export interface BatchResultFile {
  batch: number;
  results: TriageResultEntry[];
}

export function prepareBatches(
  store: Store,
  workDir: string,
  opts: { batchSize?: number; includeTriaged?: boolean } = {},
): number {
  const batchSize = opts.batchSize ?? 50;
  const queue: BatchLink[] = Object.entries(store.links)
    .filter(([, l]) => !l.junk && (opts.includeTriaged || !l.triage))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([urlHash, l]) => ({
      urlHash, url: l.url, title: l.title, dupeCount: l.dupeCount, groupHints: l.groupHints,
    }));
  if (queue.length === 0) return 0;
  mkdirSync(workDir, { recursive: true });
  let batch = 0;
  for (let i = 0; i < queue.length; i += batchSize) {
    batch += 1;
    writeFileSync(
      join(workDir, `batch-${batch}.json`),
      JSON.stringify({ batch, links: queue.slice(i, i + batchSize) }, null, 2) + '\n',
    );
  }
  return batch;
}

export function collectResultFiles(workDir: string): BatchResultFile[] {
  let names: string[];
  try {
    names = readdirSync(workDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^batch-\d+\.result\.json$/.test(n))
    .map((n) => JSON.parse(readFileSync(join(workDir, n), 'utf8')) as BatchResultFile)
    .sort((a, b) => a.batch - b.batch);
}

export function validateBatch(
  store: Store,
  file: BatchResultFile,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const [i, r] of file.results.entries()) {
    const at = `batch ${file.batch} entry ${i} (${r.urlHash})`;
    const link = store.links[r.urlHash];
    if (!link) { errors.push(`${at}: unknown urlHash`); continue; }
    if (link.junk) errors.push(`${at}: junk link, not triageable`);
    if (typeof r.category !== 'string' || r.category.trim() === '')
      errors.push(`${at}: category empty`);
    if (typeof r.keep !== 'boolean') errors.push(`${at}: keep not boolean`);
    if (!Number.isInteger(r.relevance) || r.relevance < 1 || r.relevance > 5)
      errors.push(`${at}: relevance must be integer 1-5`);
    if (typeof r.explanation !== 'string' || r.explanation.length < 1 || r.explanation.length > 160)
      errors.push(`${at}: explanation must be 1-160 chars`);
    if (r.keep === false && (!r.reason || r.reason.trim() === ''))
      errors.push(`${at}: keep=false requires reason`);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function normalizeCategory(name: string, canon: Canon): string {
  const slug = name.trim().toLowerCase().replace(/[ _]+/g, '-').replace(/-+/g, '-');
  const bare = slug.replace(/-/g, '');
  const existing = canon.categories.find((c) => c.replace(/-/g, '') === bare);
  if (existing) return existing;
  canon.categories.push(slug);
  return slug;
}

export function mergeBatch(
  store: Store,
  canon: Canon,
  file: BatchResultFile,
  now: string,
): number {
  let merged = 0;
  for (const r of file.results) {
    const link = store.links[r.urlHash];
    if (!link) continue;
    const triage: Triage = {
      category: normalizeCategory(r.category, canon),
      keep: r.keep,
      relevance: r.relevance as Triage['relevance'],
      explanation: r.explanation,
      triagedAt: now,
    };
    if (r.reason !== undefined) triage.reason = r.reason;
    link.triage = triage;
    merged += 1;
  }
  return merged;
}
