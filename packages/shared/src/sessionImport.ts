import { normalizeUrl } from './normalize.js';

export const SESSION_IMPORT_MAX_ITEMS = 200;
export const SESSION_IMPORT_MAX_BYTES = 800_000;

export interface SessionImportItem {
  snapshotId: string;
  occurrenceId: string;
  url: string;
  title?: string;
  snapshotName: string;
  groupName?: string;
  profileName?: string;
  position?: number;
}

export interface SessionImportResult {
  createdLinks: number;
  recorded: number;
  alreadyRecorded: number;
  alreadyLinked: number;
  existingProcessingEnabled: number;
  skippedDeleted: number;
  invalid: number;
}

export interface SessionImportReceipt {
  snapshotId: string;
  occurrenceId: string;
  urlHash: string;
}

export function sessionBookmarkUrl(raw: string) {
  const normalized = normalizeUrl(raw);
  if (!normalized.ok) return normalized;
  const url = new URL(normalized.url);
  if (url.username || url.password) return { ok: false as const, reason: 'credentials' as const };
  return normalized;
}
