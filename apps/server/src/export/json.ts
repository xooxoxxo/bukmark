import type { ExportLink } from './types.js';

/** Bumped only on a breaking shape change, so a future importer can branch on it. */
const FORMAT_VERSION = 1;

/**
 * The backup format. Hubs are names and there is no database id, so the file
 * restores into a fresh database rather than only into the one it came from.
 */
export function toBackupJson(links: ExportLink[], exportedAt: string): string {
  return JSON.stringify(
    { version: FORMAT_VERSION, exportedAt, count: links.length, links },
    null,
    2,
  );
}
