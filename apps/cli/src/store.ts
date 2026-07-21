import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Canon, LinkRecord, Source, Store } from '@bookmarkt/shared';

export function emptyStore(): Store {
  return { version: 1, links: {}, ingestedFiles: {} };
}

function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, file);
}

export function loadStore(file: string): Store {
  if (!existsSync(file)) return emptyStore();
  return JSON.parse(readFileSync(file, 'utf8')) as Store;
}

export function saveStore(file: string, store: Store): void {
  writeJsonAtomic(file, store);
}

export function loadCanon(file: string): Canon {
  if (!existsSync(file)) return { categories: [] };
  return JSON.parse(readFileSync(file, 'utf8')) as Canon;
}

export function saveCanon(file: string, canon: Canon): void {
  writeJsonAtomic(file, canon);
}

export function mergeCapture(
  store: Store,
  cap: { urlHash: string; url: string; title: string; groupHint?: string },
  source: Source,
  now: string,
): { added: boolean } {
  const existing = store.links[cap.urlHash];
  if (!existing) {
    const rec: LinkRecord = {
      url: cap.url,
      title: cap.title,
      sources: [source],
      dupeCount: 1,
      groupHints: cap.groupHint ? [cap.groupHint] : [],
      firstSeen: now,
      lastSeen: now,
    };
    store.links[cap.urlHash] = rec;
    return { added: true };
  }
  existing.dupeCount += 1;
  existing.lastSeen = now;
  if (!existing.sources.includes(source)) existing.sources.push(source);
  if (cap.groupHint && !existing.groupHints.includes(cap.groupHint)) {
    existing.groupHints.push(cap.groupHint);
  }
  if (existing.title === '' && cap.title !== '') existing.title = cap.title;
  return { added: false };
}
