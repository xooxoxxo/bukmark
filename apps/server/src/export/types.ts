/**
 * One link as it appears in an export.
 *
 * Hubs are NAMES, not ids: a backup has to restore into a fresh database, where
 * the original UUIDs mean nothing. For the same reason there is no `id` field.
 */
export interface ExportQuote {
  text: string;
  note: string;
  createdAt: string;
}

/** A quote whose link is gone: it keeps the address and title it was saved from. */
export interface ExportOrphanQuote extends ExportQuote {
  sourceUrl: string;
  sourceTitle: string;
}

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
  /** Oldest first. Only the JSON backup writes these. */
  quotes: ExportQuote[];
}
