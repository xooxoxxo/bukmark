import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { matchKey, SESSION_IMPORT_MAX_BYTES, sessionBookmarkUrl, type SessionImportItem } from '@bukmark/shared';

interface Tab { id: string; url: string | null; title: string | null; position: number | null; groupId: string | null }
interface Snapshot {
  id: string;
  name: string;
  file: string;
  profileName: string | null;
  partial: boolean;
  tabCount: number;
  groups: { id: string; name: string | null }[];
  tabs: Tab[];
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected an object');
  return value as Record<string, unknown>;
}

function label(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('invalid text field');
  return value;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 512 || value.includes('\0')) throw new Error('invalid record ID');
  return value;
}

function readArchive(path: string): { snapshots: Snapshot[]; skippedFiles: number } {
  const file = basename(path);
  const snapshots: Snapshot[] = [];
  const snapshotIds = new Set<string>();
  const occurrenceIds = new Set<string>();
  let skippedFiles = 0;
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
  let current: Snapshot | undefined;
  for (const [index, line] of lines.entries()) {
    try {
      const record = object(JSON.parse(line));
      if (index === 0) {
        if (record.type !== 'archive' || record.format !== 'bukmark-sessions' || record.version !== 1) {
          throw new Error('unsupported archive header');
        }
        skippedFiles = Array.isArray(record.skippedFiles) ? record.skippedFiles.length : 0;
      } else if (record.type === 'snapshot') {
        const key = id(record.id);
        const tabCount = record.tabCount;
        if (snapshotIds.has(key) || typeof tabCount !== 'number' || !Number.isSafeInteger(tabCount) || tabCount < 0) {
          throw new Error('invalid or duplicate snapshot');
        }
        if (current && current.tabs.length !== current.tabCount) throw new Error('snapshot tab count does not match its records');
        const groups = record.groups === undefined ? [] : record.groups;
        if (!Array.isArray(groups)) throw new Error('invalid groups');
        const profileName = record.profile == null ? null : label(object(record.profile).name);
        current = { id: key, name: label(record.name) ?? '', file, profileName, tabCount,
          partial: record.partial === true, groups: groups.map(value => {
            const group = object(value);
            return { id: id(group.id), name: label(group.name) };
          }), tabs: [] };
        snapshots.push(current);
        snapshotIds.add(key);
        occurrenceIds.clear();
      } else if (record.type === 'tab' && current && record.snapshotId === current.id) {
        const key = id(record.id);
        if (occurrenceIds.has(key)) throw new Error('duplicate occurrence ID');
        const position = record.position;
        if (position != null && (typeof position !== 'number' || !Number.isSafeInteger(position))) throw new Error('invalid position');
        current.tabs.push({ id: key, url: label(record.url), title: label(record.title), position: position ?? null,
          groupId: record.groupId == null ? null : id(record.groupId) });
        occurrenceIds.add(key);
      } else {
        throw new Error('unexpected record');
      }
    } catch (error) {
      const reason = error instanceof SyntaxError ? 'invalid JSON' : error instanceof Error ? error.message : 'invalid record';
      throw new Error(`${file}, line ${index + 1}: ${reason}`);
    }
  }
  if (current && current.tabs.length !== current.tabCount) throw new Error(`${file}: snapshot tab count does not match its records`);
  return { snapshots, skippedFiles };
}

function sessionText(value: string): string { return value.replaceAll('\0', ''); }

export function inspectSessions(paths: string[], selection: string[]) {
  const archives = paths.map(readArchive);
  const snapshots = archives.flatMap(archive => archive.snapshots);
  const targets = new Map<string, { snapshot: Snapshot; groupId?: string }>();
  for (const [index, snapshot] of snapshots.entries()) {
    targets.set(String(index + 1), { snapshot });
    snapshot.groups.forEach((group, groupIndex) => targets.set(`${index + 1}.${groupIndex + 1}`, { snapshot, groupId: group.id }));
  }
  for (const selector of selection) if (!targets.has(selector)) throw new Error(`Unknown session selection ${JSON.stringify(selector)}.`);
  const chosen = selection.length > 0 ? selection.map(selector => targets.get(selector)!) : snapshots.map(snapshot => ({ snapshot }));
  const items: SessionImportItem[] = [];
  const occurrences = new Set<string>();
  const bookmarks = new Set<string>();
  const omitted = { missingUrl: 0, 'non-http': 0, unparseable: 0, credentials: 0, tooLarge: 0 };
  for (const target of chosen) {
    const { snapshot } = target;
    const filter = 'groupId' in target ? target.groupId : undefined;
    const groupNames = new Map(snapshot.groups.map(group => [group.id, group.name]));
    for (const tab of snapshot.tabs) {
      const occurrence = JSON.stringify([snapshot.id, tab.id]);
      if ((filter !== undefined && tab.groupId !== filter) || occurrences.has(occurrence)) continue;
      occurrences.add(occurrence);
      if (!tab.url) { omitted.missingUrl++; continue; }
      const normalized = sessionBookmarkUrl(tab.url);
      if (!normalized.ok) { omitted[normalized.reason]++; continue; }
      const groupName = tab.groupId === null ? null : groupNames.get(tab.groupId);
      const item: SessionImportItem = {
        snapshotId: snapshot.id, occurrenceId: tab.id, url: tab.url,
        snapshotName: sessionText(snapshot.name),
        ...(tab.title !== null ? { title: sessionText(tab.title) } : {}),
        ...(groupName != null ? { groupName: sessionText(groupName) } : {}),
        ...(snapshot.profileName !== null ? { profileName: sessionText(snapshot.profileName) } : {}),
        ...(tab.position !== null ? { position: tab.position } : {}),
      };
      if (Buffer.byteLength(JSON.stringify(item)) > SESSION_IMPORT_MAX_BYTES - 128) { omitted.tooLarge++; continue; }
      items.push(item);
      bookmarks.add(matchKey(normalized.url));
    }
  }
  return { snapshots, skippedFiles: archives.reduce((n, archive) => n + archive.skippedFiles, 0), items,
    occurrences: occurrences.size, unique: bookmarks.size, omitted };
}
