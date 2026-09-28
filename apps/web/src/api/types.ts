export interface LinkDto {
  id: string;
  url: string;
  title: string;
  note: string;
  status: 'active' | 'archived';
  relevance: number | null;
  dupeCount: number;
  hubIds: string[];
  imageUrl: string | null;
  firstSeen: string;
  /** From the page's last check; absent from a save's reply. */
  httpStatus?: number | null;
  checkError?: string | null;
  broken?: boolean;
  /** With a search: the words around the match in the page's text, hits between HIT_START and HIT_END. */
  snippet?: string | null;
}

/** GET /links/:id — a link with everything bukmark holds for it. */
export interface LinkDetail extends LinkDto {
  lastSeen: string;
  contentText: string | null;
  httpStatus: number | null;
  checkError: string | null;
  checkedAt: string | null;
  broken: boolean;
}

/** Marks around matched words in a snippet (apps/server/src/routes/links.ts). */
export const HIT_START = '\u2e22';
export const HIT_END = '\u2e23';

export type LinkSort = 'relevance' | 'newest' | 'oldest' | 'title';

export interface HubDto {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'dormant' | 'archived';
  linkCount: number;
}

export interface Stats {
  links: number;
  active: number;
  archived: number;
  hubs: number;
  unassigned: number;
  broken: number;
  unchecked: number;
}

export interface LinksQuery {
  q?: string;
  hub?: string;
  unassigned?: boolean;
  status?: 'active' | 'archived';
  broken?: boolean;
  sort?: LinkSort;
  limit?: number;
  offset?: number;
}

export type BulkAction = 'archive' | 'activate' | 'assign' | 'unassign' | 'delete';

export interface LinkPatch {
  title?: string;
  note?: string;
  status?: 'active' | 'archived';
  relevance?: number | null;
}

export interface HubPatch {
  name?: string;
  description?: string;
  status?: 'active' | 'dormant' | 'archived';
}
