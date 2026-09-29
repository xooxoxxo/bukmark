import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { hubs } from '../db/schema.js';
import { toCsv } from '../export/csv.js';
import { exportFilename } from '../export/filename.js';
import { toBackupJson } from '../export/json.js';
import { toNetscapeHtml } from '../export/netscape.js';
import { selectForExport, selectOrphanQuotes, type ExportFilters } from '../export/query.js';

const CONTENT_TYPE = {
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
} as const;

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/export', {
    schema: {
      querystring: Type.Object({
        format: Type.Union([Type.Literal('html'), Type.Literal('json'), Type.Literal('csv')]),
        q: Type.Optional(Type.String()),
        hub: Type.Optional(Type.String({ format: 'uuid' })),
        unassigned: Type.Optional(Type.Boolean()),
        broken: Type.Optional(Type.Boolean()),
        status: Type.Optional(
          Type.Union([Type.Literal('active'), Type.Literal('archived'), Type.Literal('all')]),
        ),
      }),
    },
  }, async (req, reply) => {
    const { format, q, hub, unassigned, broken, status = 'active' } = req.query as {
      format: 'html' | 'json' | 'csv';
      q?: string; hub?: string; unassigned?: boolean; broken?: boolean;
      status?: 'active' | 'archived' | 'all';
    };

    const filters: ExportFilters = { q, hub, unassigned, broken, status };
    const rows = await selectForExport(req.server.db, filters);

    // Scope names the file. A hub name is user-supplied and reaches a response
    // header, which is why exportFilename slugs it rather than trusting it.
    let scope = 'all';
    if (hub) {
      const [row] = await req.server.db
        .select({ name: hubs.name }).from(hubs).where(eq(hubs.id, hub)).limit(1);
      scope = row?.name ?? 'hub';
    } else if (broken) {
      scope = 'broken';
    } else if (unassigned) {
      scope = 'unsorted';
    }

    // Orphan quotes belong to no link, so a filtered export (a hub, a search)
    // has no honest place for them. Only the unfiltered export carries them.
    const fullBackup = !q && !hub && !unassigned && !broken && status !== 'archived';

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const body =
      format === 'html' ? toNetscapeHtml(rows)
      : format === 'csv' ? toCsv(rows)
      : toBackupJson(rows, now.toISOString(), fullBackup ? await selectOrphanQuotes(req.server.db) : []);

    return reply
      .header('content-type', CONTENT_TYPE[format])
      .header('content-disposition', `attachment; filename="${exportFilename(scope, format, date)}"`)
      .send(body);
  });
}
