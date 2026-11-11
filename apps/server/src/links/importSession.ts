import { asc, inArray, or, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { matchKey, sessionBookmarkUrl, sha256Hex, type SessionImportItem, type SessionImportReceipt, type SessionImportResult } from '@bukmark/shared';
import type { Db } from '../db/client.js';
import { captures, deletedHashes, links } from '../db/schema.js';

const occurrenceKey = ({ snapshotId, occurrenceId }: SessionImportItem) => sha256Hex(JSON.stringify([snapshotId, occurrenceId]));

export async function verifySessionImport(db: Db, items: SessionImportItem[]): Promise<SessionImportReceipt[]> {
  const candidates = items.flatMap(item => {
    const url = sessionBookmarkUrl(item.url);
    return url.ok ? [{ item, url, key: occurrenceKey(item) }] : [];
  });
  if (!candidates.length) return [];
  return db.transaction(async tx => {
    const rows = await tx.select({ key: captures.sessionOccurrenceKey, url: captures.originalUrl,
      title: captures.originalTitle, context: captures.raw, source: captures.source })
      .from(captures).where(inArray(captures.sessionOccurrenceKey, candidates.map(row => row.key)));
    const byKey = new Map(rows.map(row => [row.key, row]));
    const tombstones = await tx.select({ hash: deletedHashes.urlHash }).from(deletedHashes)
      .where(inArray(deletedHashes.urlHash, candidates.map(row => row.url.urlHash)));
    const deleted = new Set(tombstones.map(row => row.hash));
    return candidates.flatMap(({ item, url, key }) => {
      const row = byKey.get(key);
      const { url: originalUrl, title, ...context } = item;
      if (!row || deleted.has(url.urlHash) || row.source !== 'browser-session' || row.url !== originalUrl
        || row.title !== (title ?? '') || !isDeepStrictEqual(row.context, context)) return [];
      return [{ snapshotId: item.snapshotId, occurrenceId: item.occurrenceId, urlHash: sha256Hex(originalUrl) }];
    });
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

async function findLinks(db: Pick<Db, 'select'>, items: { urlHash: string; key: string }[]) {
  return db.select({ id: links.id, urlHash: links.urlHash, key: links.matchKey, protected: links.sessionProtected })
    .from(links).where(or(inArray(links.urlHash, items.map(item => item.urlHash)), inArray(links.matchKey, items.map(item => item.key))))
    .orderBy(asc(links.id));
}

export async function importSession(db: Db, items: SessionImportItem[], preview: boolean): Promise<SessionImportResult> {
  const result: SessionImportResult = {
    createdLinks: 0, recorded: 0, alreadyRecorded: 0, alreadyLinked: 0,
    existingProcessingEnabled: 0, skippedDeleted: 0, invalid: 0,
  };
  const normalized = items.flatMap(item => {
    const address = sessionBookmarkUrl(item.url);
    if (!address.ok || Object.values(item).some(value => typeof value === 'string' && value.includes('\0'))) {
      result.invalid++;
      return [];
    }
    return [{ item, url: address.url, urlHash: address.urlHash, key: matchKey(address.url),
      occurrenceKey: occurrenceKey(item) }];
  });
  if (normalized.length === 0) return result;

  return db.transaction(async tx => {
    // Serialize session writers so two variants of a URL cannot both create a
    // bookmark between the match-key lookup and insert.
    if (!preview) await tx.execute(sql`SELECT pg_advisory_xact_lock(644142198)`);
    const prior = await tx.select({ key: captures.sessionOccurrenceKey }).from(captures)
      .where(inArray(captures.sessionOccurrenceKey, normalized.map(item => item.occurrenceKey)));
    const seen = new Set(prior.map(row => row.key));
    const tombstones = await tx.select({ hash: deletedHashes.urlHash }).from(deletedHashes)
      .where(inArray(deletedHashes.urlHash, normalized.map(item => item.urlHash)));
    const deleted = new Set(tombstones.map(row => row.hash));
    const pending = normalized.filter(item => {
      if (seen.has(item.occurrenceKey)) { result.alreadyRecorded++; return false; }
      if (deleted.has(item.urlHash)) { result.skippedDeleted++; return false; }
      seen.add(item.occurrenceKey);
      return true;
    });
    if (pending.length === 0) return result;

    const existing = await findLinks(tx, pending);
    const exact = new Map(existing.map(row => [row.urlHash, row]));
    const variants = new Map<string, typeof existing[number]>();
    for (const row of existing) if (row.key && !variants.has(row.key)) variants.set(row.key, row);
    const newByKey = new Map<string, typeof pending[number]>();
    const resolved = pending.map(entry => {
      const link = exact.get(entry.urlHash) ?? variants.get(entry.key);
      if (link) {
        result.alreadyLinked++;
        if (!link.protected) result.existingProcessingEnabled++;
      } else if (!newByKey.has(entry.key)) newByKey.set(entry.key, entry);
      return { entry, link };
    });
    if (preview) {
      result.createdLinks = newByKey.size;
      result.recorded = pending.length;
      return result;
    }

    const newEntries = [...newByKey.values()];
    const created = new Map<string, string>();
    if (newEntries.length > 0) {
      const rows = await tx.insert(links).values(newEntries.map(entry => ({
        url: entry.url, urlHash: entry.urlHash, matchKey: entry.key, title: entry.item.title ?? '', sessionProtected: true,
      }))).onConflictDoNothing({ target: links.urlHash }).returning({ id: links.id, key: links.matchKey });
      result.createdLinks = rows.length;
      for (const row of rows) created.set(row.key!, row.id);
      // A normal save may have inserted the exact URL since our lookup.
      const conflicted = newEntries.filter(entry => !created.has(entry.key));
      if (conflicted.length > 0) {
        const matches = await findLinks(tx, conflicted);
        for (const entry of conflicted) {
          const match = matches.find(row => row.urlHash === entry.urlHash);
          if (!match) throw new Error('Concurrent bookmark change');
          created.set(entry.key, match.id);
          const occurrences = resolved.filter(row => !row.link && row.entry.key === entry.key).length;
          result.alreadyLinked += occurrences;
          if (!match.protected) result.existingProcessingEnabled += occurrences;
        }
      }
    }

    const written = await tx.insert(captures).values(resolved.map(({ entry, link }) => {
      const { url, title, ...context } = entry.item;
      return {
        linkId: link?.id ?? created.get(entry.key)!, source: 'browser-session',
        originalUrl: url, originalTitle: title ?? '', sessionOccurrenceKey: entry.occurrenceKey,
        groupHint: [context.profileName, context.snapshotName, context.groupName].filter(Boolean).join(' / ') || null,
        raw: context,
      };
    })).onConflictDoNothing({ target: captures.sessionOccurrenceKey }).returning({ id: captures.id });
    result.recorded = written.length;
    return result;
  });
}
