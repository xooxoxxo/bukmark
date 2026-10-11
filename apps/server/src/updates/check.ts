/**
 * Update checks: read the release feed and keep the result in app_settings.
 * A check is one GET to the feed; errors are stored for the page to show,
 * never thrown. The background timer checks at most every 12 hours.
 */
import { eq, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { appSettings } from '../db/schema.js';
import { checkDue, currentCheck, effectiveFeed, parseReleases, type UpdatesEnv, type UpdatesSettings } from './feed.js';

/** GitHub asks for a User-Agent; this one names the app and nothing else. */
export const FEED_USER_AGENT = 'bukmark-update-check';
const FEED_TIMEOUT_MS = 10_000;
const KEY = 'updates';

export async function readUpdates(db: Db): Promise<UpdatesSettings> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY));
  return (row?.value ?? {}) as UpdatesSettings;
}

/**
 * Merge `patch` into the stored settings and return them as stored now. Each
 * write names only the fields it changes, so a check that takes up to 10 s
 * and a change the owner makes meanwhile do not undo each other.
 */
export async function patchUpdates(db: Db, patch: Partial<UpdatesSettings>): Promise<UpdatesSettings> {
  const [row] = await db.insert(appSettings)
    .values({ key: KEY, value: patch })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: dsql`${appSettings.value} || excluded.value`, updatedAt: dsql`now()` },
    })
    .returning({ value: appSettings.value });
  return (row?.value ?? patch) as UpdatesSettings;
}

type FeedResult =
  | { status: 'fresh'; etag: string | null; releases: ReturnType<typeof parseReleases> }
  | { status: 'unchanged' };

async function fetchFeed(fetchFn: typeof fetch, url: string, etag: string | null): Promise<FeedResult> {
  const res = await fetchFn(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': FEED_USER_AGENT,
      ...(etag ? { 'If-None-Match': etag } : {}),
    },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (res.status === 304) return { status: 'unchanged' };
  if (!res.ok) throw new Error(`the feed answered ${res.status}`);
  return { status: 'fresh', etag: res.headers.get('etag'), releases: parseReleases(await res.json()) };
}

/** A short message for the page, not a stack. */
function shortError(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'the feed did not answer within 10 s';
  if (e?.name === 'SyntaxError') return 'the feed did not answer with JSON';
  return (e?.message || 'the check failed').slice(0, 200);
}

/** Read the feed in force and store the result. A 304 keeps the stored releases. */
export async function runCheck(db: Db, env: UpdatesEnv): Promise<UpdatesSettings> {
  const updates = await readUpdates(db);
  const feed = effectiveFeed(updates, env.feed);
  if (!feed.url) return updates;
  const previous = currentCheck(updates, feed);
  const at = new Date().toISOString();
  let lastCheck: NonNullable<UpdatesSettings['lastCheck']>;
  try {
    const result = await fetchFeed(env.fetch, feed.url, previous?.etag ?? null);
    lastCheck = result.status === 'unchanged'
      ? { at, url: feed.url, etag: previous?.etag ?? null, releases: previous?.releases ?? [], error: null }
      : { at, url: feed.url, etag: result.etag, releases: result.releases, error: null };
  } catch (err) {
    lastCheck = { at, url: feed.url, etag: previous?.etag ?? null, releases: previous?.releases ?? [], error: shortError(err) };
  }
  return patchUpdates(db, { lastCheck });
}

/**
 * Background checks: 30 s after start, then hourly, check when the last
 * check is 12 hours old. Timers stop when the app closes.
 */
export function startUpdateChecks(
  app: FastifyInstance,
  env: UpdatesEnv,
  { firstDelayMs = 30_000, intervalMs = 3600_000 } = {},
): void {
  let inflight: Promise<void> | null = null;
  const check = async (): Promise<void> => {
    try {
      const updates = await readUpdates(app.db);
      if (!checkDue(updates, effectiveFeed(updates, env.feed), Date.now())) return;
      const next = await runCheck(app.db, env);
      if (next.lastCheck?.error) app.log.warn({ error: next.lastCheck.error }, 'update check failed');
    } catch (err) {
      app.log.warn({ err }, 'update check skipped');
    }
  };
  const tick = (): void => {
    if (inflight) return;
    inflight = check().finally(() => { inflight = null; });
  };
  const first = setTimeout(tick, firstDelayMs);
  const every = setInterval(tick, intervalMs);
  first.unref();
  every.unref();
  // A check still writing after close would outlive the pool being shut down.
  app.addHook('onClose', async () => { clearTimeout(first); clearInterval(every); await inflight; });
}
