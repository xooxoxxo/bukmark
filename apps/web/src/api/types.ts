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
}

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
}

export interface LinksQuery {
  q?: string;
  hub?: string;
  unassigned?: boolean;
  status?: 'active' | 'archived';
  limit?: number;
  offset?: number;
}

export type BulkAction = 'archive' | 'activate' | 'assign' | 'unassign' | 'delete';

export interface LinkPatch {
  title?: string;
  note?: string;
  status?: 'active' | 'archived';
}

export interface HubPatch {
  name?: string;
  description?: string;
  status?: 'active' | 'dormant' | 'archived';
}
