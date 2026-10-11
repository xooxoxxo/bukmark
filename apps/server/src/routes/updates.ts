import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { buildStatus, currentCheck, effectiveFeed, type UpdatesEnv, type UpdatesSettings } from '../updates/feed.js';
import { patchUpdates, readUpdates, runCheck } from '../updates/check.js';

/** "Check now" fetches at most once a minute; a double click does not fetch twice. */
const MANUAL_MIN_GAP_MS = 60_000;

/**
 * Settings › Updates. Nothing here performs an update: the page shows the
 * command for the way this server was installed.
 */
export async function updateRoutes(app: FastifyInstance, opts: { env: UpdatesEnv }): Promise<void> {
  const { env } = opts;

  app.get('/updates', async (req) => buildStatus(await readUpdates(req.server.db), env));

  app.post('/updates/check', async (req, reply) => {
    const updates = await readUpdates(req.server.db);
    const feed = effectiveFeed(updates, env.feed);
    if (!feed.enabled) return reply.code(409).send({ error: 'update checks are off' });
    const last = currentCheck(updates, feed);
    const recent = last && Date.now() - Date.parse(last.at) < MANUAL_MIN_GAP_MS;
    return buildStatus(recent ? updates : await runCheck(req.server.db, env), env);
  });

  app.patch('/updates', {
    schema: {
      body: Type.Object({
        enabled: Type.Optional(Type.Boolean()),
        // null stops skipping.
        skippedVersion: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 64, pattern: '\\S' }), Type.Null()])),
      }),
    },
  }, async (req, reply) => {
    const body = req.body as { enabled?: boolean; skippedVersion?: string | null };
    const patch: Partial<UpdatesSettings> = {};
    if (body.enabled !== undefined) {
      if (effectiveFeed({}, env.feed).lockedByServer) {
        return reply.code(409).send({ error: 'update checks are set by the server (BUKMARK_UPDATE_FEED)' });
      }
      patch.enabled = body.enabled;
    }
    if (body.skippedVersion !== undefined) {
      patch.skippedVersion = body.skippedVersion === null ? null : body.skippedVersion.trim().replace(/^v/i, '');
    }
    const next = Object.keys(patch).length > 0 ? await patchUpdates(req.server.db, patch) : await readUpdates(req.server.db);
    return buildStatus(next, env);
  });
}
