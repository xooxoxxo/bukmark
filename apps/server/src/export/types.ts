/**
 * One link as it appears in an export.
 *
 * Hubs are NAMES, not ids: a backup has to restore into a fresh database, where
 * the original UUIDs mean nothing. For the same reason there is no `id` field.
 */
export interface ExportLink {
  url: string;
  title: string;
  note: string;
  status: string;
  relevance: number | null;
  dupeCount: number;
  hubs: string[];
  imageUrl: string | null;
  groupHint: string | null;
  firstSeen: string;
  lastSeen: string;
}
