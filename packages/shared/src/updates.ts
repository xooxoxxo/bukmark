/**
 * Settings › Updates: what the server is running, whether a newer release is
 * out, and its notes. The server checks the official GitHub releases; the
 * page shows the command to update with, it never updates by itself.
 */

/** The official release feed. BUKMARK_UPDATE_FEED ("off" or a URL) overrides it. */
export const DEFAULT_RELEASES_URL = 'https://api.github.com/repos/xooxoxxo/bukmark/releases';

/** The server checks the feed on its own at most this often. */
export const UPDATE_CHECK_INTERVAL_MS = 12 * 3600 * 1000;

export interface ReleaseNote {
  tag: string;
  /** The tag without a leading v. */
  version: string;
  name: string | null;
  /** Markdown release notes. */
  body: string | null;
  publishedAt: string | null;
  url: string | null;
  prerelease: boolean;
  /** The release has the requires-attention label, or says so in its notes. */
  requiresAttention: boolean;
}

/** installer: the bukmark command's compose file; source: the repo's docker-compose.yml. */
export type InstallMethod = 'installer' | 'source' | 'unknown';

export interface UpdatesStatus {
  /** The running version, "dev" for a development build. */
  version: string;
  development: boolean;
  install: InstallMethod;
  enabled: boolean;
  /** BUKMARK_UPDATE_FEED decides; the page cannot turn checks on or off. */
  lockedByServer: boolean;
  lastCheckedAt: string | null;
  error: string | null;
  /** The newest release that is not a prerelease. */
  latest: ReleaseNote | null;
  /** Releases newer than the running one, newest first, prereleases left out. */
  newer: ReleaseNote[];
  skippedVersion: string | null;
  /** A newer release above the skipped one exists, and this is not a development build. */
  updateAvailable: boolean;
}

/** PATCH /api/updates. skippedVersion null stops skipping. */
export interface SetUpdates {
  enabled?: boolean;
  skippedVersion?: string | null;
}

/** Numeric dotted compare; a leading "v" and any pre-release suffix are ignored. Returns <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/i, '').split('-')[0]!.split('.').map((p) => parseInt(p, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
