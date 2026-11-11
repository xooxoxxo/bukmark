import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { SESSION_IMPORT_MAX_BYTES, SESSION_IMPORT_MAX_ITEMS, sha256Hex, type SessionImportItem, type SessionImportReceipt, type SessionImportResult } from '@bukmark/shared';
import { inspectSessions } from './inspect.js';

function* batches(items: SessionImportItem[]): Generator<SessionImportItem[]> {
  let batch: SessionImportItem[] = [];
  // Fixed body fields, plus a comma per item. Keep both requests below the limit.
  let size = 64;
  for (const item of items) {
    const bytes = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (batch.length === SESSION_IMPORT_MAX_ITEMS || size + bytes > SESSION_IMPORT_MAX_BYTES) {
      yield batch;
      batch = [];
      size = 64;
    }
    batch.push(item);
    size += bytes;
  }
  if (batch.length) yield batch;
}

function endpoint(raw: string): URL {
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a bukmark HTTPS origin or an HTTP loopback origin, without a path or credentials.');
  }
  return new URL('/api/links/session-import', url);
}

export async function verifySessionItems(destination: string, token: string, selection: SessionImportItem[]) {
  const url = endpoint(destination);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const verified: SessionImportReceipt[] = [];
  for (const items of batches(selection)) {
    const response = await fetch(new URL(`${url.pathname}/verify`, url), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000), headers,
      body: JSON.stringify({ items }),
    });
    if (!response.ok) throw new Error(`Verification failed (HTTP ${response.status}).`);
    const result = await response.json() as { verified?: SessionImportReceipt[] };
    const expected = new Map(items.map(item => [JSON.stringify([item.snapshotId, item.occurrenceId]), sha256Hex(item.url)]));
    if (!Array.isArray(result?.verified)) throw new Error('Invalid verification response.');
    for (const row of result.verified) {
      if (!row || typeof row.urlHash !== 'string') throw new Error('Invalid verification response.');
      const key = JSON.stringify([row.snapshotId, row.occurrenceId]);
      if (expected.get(key) !== row.urlHash) throw new Error('The response contains an unexpected tab receipt.');
      expected.delete(key);
      verified.push({ snapshotId: row.snapshotId, occurrenceId: row.occurrenceId, urlHash: row.urlHash });
    }
  }
  return verified;
}

export async function runSessionSelection(action: 'inspect' | 'import' | 'verify', args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    select: { type: 'string', multiple: true },
    ...(action !== 'inspect' ? {
      all: { type: 'boolean' as const }, destination: { type: 'string' as const },
    } : {}),
    ...(action === 'import' ? {
      preview: { type: 'boolean' as const }, apply: { type: 'boolean' as const },
    } : {}),
    ...(action === 'verify' ? { receipt: { type: 'string' as const } } : {}),
  } });
  if (!positionals.length) throw new Error('Provide one or more session archive files.');
  const selection = values.select ?? [];
  if (action === 'import' && (Boolean(values.all) === (selection.length > 0)
    || Boolean(values.preview) === Boolean(values.apply) || !values.destination)) {
    throw new Error('Choose --select or --all, a --destination, and either --preview or --apply.');
  }
  if (action === 'verify' && (Boolean(values.all) === (selection.length > 0) || !values.destination || !values.receipt)) {
    throw new Error('Choose --select or --all, a --destination, and a --receipt path.');
  }
  const inspection = inspectSessions(positionals, selection);
  if (action === 'inspect') {
    for (const [index, snapshot] of inspection.snapshots.entries()) {
      const profile = snapshot.profileName === null ? '' : ` (${JSON.stringify(snapshot.profileName)})`;
      console.log(`${index + 1}. ${JSON.stringify(snapshot.name)}${profile} — ${snapshot.tabCount} tabs${snapshot.partial ? ' [partial]' : ''} — ${JSON.stringify(snapshot.file)}`);
      for (const [groupIndex, group] of snapshot.groups.entries()) {
        const count = snapshot.tabs.filter(tab => tab.groupId === group.id).length;
        console.log(`  ${index + 1}.${groupIndex + 1}. ${JSON.stringify(group.name ?? 'Unnamed group')} — ${count} tabs`);
      }
    }
  }
  console.log(`${inspection.occurrences} selected tab occurrences, ${inspection.items.length} bookmark occurrences, ${inspection.unique} unique bookmark candidates.`);
  const omitted = Object.entries(inspection.omitted).filter(([, count]) => count).map(([reason, count]) => `${reason} ${count}`);
  if (omitted.length) console.log(`Omitted: ${omitted.join(', ')}.`);
  if (inspection.skippedFiles) console.log(`${inspection.skippedFiles} source files were skipped during capture.`);
  if (action === 'inspect' || (action === 'import' && !inspection.items.length)) return 0;

  if (typeof values.destination !== 'string') throw new Error('Provide a bukmark origin with --destination.');
  const url = endpoint(values.destination);
  const token = process.env.BUKMARK_TOKEN;
  if (!token) throw new Error('Set BUKMARK_TOKEN before contacting the destination.');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  if (action === 'verify') {
    if (typeof values.receipt !== 'string') throw new Error('Choose a --receipt path.');
    const verified = await verifySessionItems(values.destination, token, inspection.items);
    writeFileSync(values.receipt, JSON.stringify({ version: 1, destination: url.origin, verified }) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`${verified.length} saved tab occurrences verified; ${inspection.items.length - verified.length} could not be verified.`);
    return 0;
  }
  const total: SessionImportResult = {
    createdLinks: 0, recorded: 0, alreadyRecorded: 0, alreadyLinked: 0,
    existingProcessingEnabled: 0, skippedDeleted: 0, invalid: 0,
  };
  let completed = 0;
  for (const items of batches(inspection.items)) {
    try {
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers,
        body: JSON.stringify({ preview: Boolean(values.preview), items }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as SessionImportResult;
      const keys = Object.keys(total) as (keyof SessionImportResult)[];
      if (!result || keys.some(key => !Number.isSafeInteger(result[key]) || result[key] < 0)) throw new Error('invalid response');
      for (const key of keys) total[key] += result[key];
      completed++;
    } catch (error) {
      const status = error instanceof Error && /^HTTP \d{3}$/.test(error.message) ? ` (${error.message})` : '';
      throw new Error(`${values.preview ? 'Preview' : 'Import'} stopped after ${completed} completed batches${status}. Retry with the same selection.`);
    }
  }
  if (values.preview) console.log(`${total.createdLinks} bookmarks would be created; ${total.recorded} tab occurrences would be recorded.`);
  else console.log(`${total.createdLinks} bookmarks created; ${total.recorded} tab occurrences recorded.`);
  console.log(`${total.alreadyRecorded} already recorded; ${total.alreadyLinked} matched existing bookmarks; ${total.skippedDeleted} deleted; ${total.invalid} invalid.`);
  if (total.existingProcessingEnabled) console.log(`${total.existingProcessingEnabled} occurrences match bookmarks already eligible for page checks or browser sync.`);
  return 0;
}
