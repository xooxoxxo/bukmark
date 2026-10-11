/**
 * The pure parts of Settings › Updates: which feed is in force, whether a
 * check is due, what a GitHub release means, and the status the page shows.
 * check.ts does the I/O.
 *
 * Privacy: a check is one GET to the feed with a fixed User-Agent. No
 * version, id or bookmark data is sent.
 */
import {
  DEFAULT_RELEASES_URL, UPDATE_CHECK_INTERVAL_MS, compareVersions,
  type InstallMethod, type ReleaseNote, type UpdatesStatus,
} from '@bukmark/shared';
import { isFeedOff } from '../config.js';

/** Stored as app_settings.value where key = 'updates'. */
export interface UpdatesSettings {
  /** false turns checks off. Unset means on. */
  enabled?: boolean;
  skippedVersion?: string | null;
  lastCheck?: {
    at: string;
    /** The feed this check read; a different feed starts over. */
    url: string;
    etag: string | null;
    releases: ReleaseNote[];
    error: string | null;
  } | null;
}

/** What the running process knows about itself; buildApp fills it from config. */
export interface UpdatesEnv {
  /** BUKMARK_APP_VERSION as set. */
  version: string | undefined;
  /** BUKMARK_INSTALL_METHOD as set. */
  install: string | undefined;
  /** BUKMARK_UPDATE_FEED as set. */
  feed: string | undefined;
  fetch: typeof fetch;
}

export interface EffectiveFeed {
  /** null when checks are off. */
  url: string | null;
  enabled: boolean;
  lockedByServer: boolean;
}

/**
 * The running version without a leading v, or "dev". Unset, "dev", or a
 * build that is not a release number (an edge build tagged "main") is a
 * development build: nothing counts as an update for it.
 */
export function runningVersion(raw: string | undefined): { version: string; development: boolean } {
  const v = raw?.trim().replace(/^v/i, '') ?? '';
  if (!/^\d+(\.\d+)*/.test(v)) return { version: 'dev', development: true };
  return { version: v, development: false };
}

export function installMethod(raw: string | undefined): InstallMethod {
  const v = raw?.trim().toLowerCase();
  return v === 'installer' || v === 'source' ? v : 'unknown';
}

/** BUKMARK_UPDATE_FEED, when set, wins over the page's setting: "off" or a URL. */
export function effectiveFeed(updates: UpdatesSettings, serverFeed: string | undefined): EffectiveFeed {
  const server = serverFeed?.trim();
  if (server) {
    if (isFeedOff(server)) return { url: null, enabled: false, lockedByServer: true };
    return { url: server, enabled: true, lockedByServer: true };
  }
  if (updates.enabled === false) return { url: null, enabled: false, lockedByServer: false };
  return { url: DEFAULT_RELEASES_URL, enabled: true, lockedByServer: false };
}

/** The last check, when it read the feed in force now. */
export function currentCheck(updates: UpdatesSettings, feed: EffectiveFeed) {
  const check = updates.lastCheck ?? null;
  if (!check || !feed.url || check.url !== feed.url) return null;
  return check;
}

/** An automatic check is due when checks are on and the last one is 12 h old (or never ran). */
export function checkDue(updates: UpdatesSettings, feed: EffectiveFeed, now: number): boolean {
  if (!feed.enabled || !feed.url) return false;
  const check = currentCheck(updates, feed);
  if (!check) return true;
  const at = Date.parse(check.at);
  return !Number.isFinite(at) || now - at >= UPDATE_CHECK_INTERVAL_MS;
}

/** GitHub Releases API item → ReleaseNote; unknown shapes and drafts are skipped. */
export function toReleaseNote(raw: unknown): ReleaseNote | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const tag = typeof r['tag_name'] === 'string' ? r['tag_name'] : null;
  if (!tag || r['draft'] === true) return null;
  const labels = Array.isArray(r['labels'])
    ? (r['labels'] as Array<{ name?: unknown } | null>).map((l) => (typeof l?.name === 'string' ? l.name : ''))
    : [];
  const body = typeof r['body'] === 'string' ? r['body'] : null;
  return {
    tag,
    version: tag.replace(/^v/i, ''),
    name: typeof r['name'] === 'string' ? r['name'] : null,
    body,
    publishedAt: typeof r['published_at'] === 'string' ? r['published_at'] : null,
    url: typeof r['html_url'] === 'string' ? r['html_url'] : null,
    prerelease: r['prerelease'] === true,
    requiresAttention: labels.includes('requires-attention') || /requires[- ]attention/i.test(body ?? ''),
  };
}

/** A feed response → its releases, newest first. */
export function parseReleases(json: unknown, keep = 20): ReleaseNote[] {
  const list = Array.isArray(json) ? json : [json];
  return list.map(toReleaseNote).filter((r): r is ReleaseNote => r !== null)
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, keep);
}

export function buildStatus(updates: UpdatesSettings, env: Pick<UpdatesEnv, 'version' | 'install' | 'feed'>): UpdatesStatus {
  const { version, development } = runningVersion(env.version);
  const feed = effectiveFeed(updates, env.feed);
  const check = currentCheck(updates, feed);
  const releases = feed.enabled ? check?.releases ?? [] : [];
  const stable = releases.filter((r) => !r.prerelease);
  // A development build has no place in the release order: nothing is newer.
  const newer = development ? [] : stable.filter((r) => compareVersions(r.version, version) > 0);
  const skipped = updates.skippedVersion ?? null;
  const unskipped = newer.filter((r) => !skipped || compareVersions(r.version, skipped) > 0);
  return {
    version,
    development,
    install: installMethod(env.install),
    enabled: feed.enabled,
    lockedByServer: feed.lockedByServer,
    lastCheckedAt: check?.at ?? null,
    error: feed.enabled ? check?.error ?? null : null,
    latest: stable[0] ?? null,
    newer,
    skippedVersion: skipped,
    updateAvailable: unskipped.length > 0,
  };
}
