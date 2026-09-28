export type ExportFormat = 'html' | 'json' | 'csv';

export interface ExportOptions {
  format: ExportFormat;
  q?: string;
  hub?: string;
  unassigned?: boolean;
  broken?: boolean;
  status?: 'active' | 'archived' | 'all';
}

/**
 * The download URL for an export.
 *
 * Deliberately not routed through api/client.ts: its http() helper always calls
 * res.json(), which would mangle an HTML or CSV download. The response carries
 * Content-Disposition: attachment, so a plain anchor is enough — no blob
 * juggling, and the browser handles saving.
 */
export function buildExportUrl(opts: ExportOptions): string {
  const params = new URLSearchParams({ format: opts.format });
  if (opts.q) params.set('q', opts.q);
  if (opts.hub) params.set('hub', opts.hub);
  if (opts.unassigned) params.set('unassigned', 'true');
  if (opts.broken) params.set('broken', 'true');
  if (opts.status) params.set('status', opts.status);
  return `/api/export?${params.toString()}`;
}
