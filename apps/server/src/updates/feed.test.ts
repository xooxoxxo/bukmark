import { describe, expect, it } from 'vitest';
import { DEFAULT_RELEASES_URL, UPDATE_CHECK_INTERVAL_MS, type ReleaseNote } from '@bukmark/shared';
import {
  buildStatus, checkDue, effectiveFeed, installMethod, parseReleases, runningVersion, toReleaseNote,
  type UpdatesSettings,
} from './feed.js';

function release(version: string, extra: Partial<ReleaseNote> = {}): ReleaseNote {
  return {
    tag: `v${version}`, version, name: `bukmark ${version}`, body: null, publishedAt: null,
    url: `https://github.com/xooxoxxo/bukmark/releases/tag/v${version}`, prerelease: false, requiresAttention: false,
    ...extra,
  };
}

function checked(releases: ReleaseNote[], extra: Partial<UpdatesSettings> = {}): UpdatesSettings {
  return {
    lastCheck: { at: '2026-10-11T10:00:00.000Z', url: DEFAULT_RELEASES_URL, etag: null, releases, error: null },
    ...extra,
  };
}

const env = { version: '0.3.0', install: 'installer', feed: undefined };

describe('toReleaseNote', () => {
  it('reads a GitHub release', () => {
    expect(toReleaseNote({
      tag_name: 'v0.4.0', name: 'bukmark 0.4.0', body: 'Notes', published_at: '2026-10-01T00:00:00Z',
      html_url: 'https://github.com/xooxoxxo/bukmark/releases/tag/v0.4.0', prerelease: false, draft: false, labels: [],
    })).toEqual({
      tag: 'v0.4.0', version: '0.4.0', name: 'bukmark 0.4.0', body: 'Notes', publishedAt: '2026-10-01T00:00:00Z',
      url: 'https://github.com/xooxoxxo/bukmark/releases/tag/v0.4.0', prerelease: false, requiresAttention: false,
    });
  });

  it('skips drafts and shapes it does not know', () => {
    expect(toReleaseNote({ tag_name: 'v0.4.0', draft: true })).toBeNull();
    expect(toReleaseNote({ name: 'no tag' })).toBeNull();
    expect(toReleaseNote('v0.4.0')).toBeNull();
    expect(toReleaseNote(null)).toBeNull();
  });

  it('marks requires-attention from the label or the notes', () => {
    expect(toReleaseNote({ tag_name: 'v1', labels: [{ name: 'requires-attention' }] })?.requiresAttention).toBe(true);
    expect(toReleaseNote({ tag_name: 'v1', body: 'This release Requires attention: back up first.' })?.requiresAttention).toBe(true);
    expect(toReleaseNote({ tag_name: 'v1', body: 'Small fixes.', labels: [null, { name: 1 }] })?.requiresAttention).toBe(false);
  });
});

describe('parseReleases', () => {
  it('keeps releases newest first by version, drafts dropped', () => {
    const list = parseReleases([
      { tag_name: 'v0.3.0' }, { tag_name: 'v0.10.0' }, { tag_name: 'v0.4.0', draft: true }, { tag_name: 'v0.9.1' },
    ]);
    expect(list.map((r) => r.version)).toEqual(['0.10.0', '0.9.1', '0.3.0']);
  });

  it('reads a single release object and caps the list', () => {
    expect(parseReleases({ tag_name: 'v1.0.0' }).map((r) => r.version)).toEqual(['1.0.0']);
    expect(parseReleases(Array.from({ length: 30 }, (_, i) => ({ tag_name: `v0.${i}.0` }))).length).toBe(20);
  });
});

describe('build identity', () => {
  it('treats unset, dev and non-release versions as a development build', () => {
    expect(runningVersion(undefined)).toEqual({ version: 'dev', development: true });
    expect(runningVersion('dev')).toEqual({ version: 'dev', development: true });
    expect(runningVersion('main')).toEqual({ version: 'dev', development: true });
    expect(runningVersion('v0.3.0')).toEqual({ version: '0.3.0', development: false });
  });

  it('reads the install method, unknown otherwise', () => {
    expect(installMethod('installer')).toBe('installer');
    expect(installMethod(' Source ')).toBe('source');
    expect(installMethod('portainer')).toBe('unknown');
    expect(installMethod(undefined)).toBe('unknown');
  });
});

describe('effectiveFeed', () => {
  it('is the official feed unless turned off', () => {
    expect(effectiveFeed({}, undefined)).toEqual({ url: DEFAULT_RELEASES_URL, enabled: true, lockedByServer: false });
    expect(effectiveFeed({ enabled: false }, '')).toEqual({ url: null, enabled: false, lockedByServer: false });
  });

  it('lets BUKMARK_UPDATE_FEED win and lock the setting', () => {
    for (const off of ['off', 'false', '0', 'no', 'OFF']) {
      expect(effectiveFeed({ enabled: true }, off)).toEqual({ url: null, enabled: false, lockedByServer: true });
    }
    expect(effectiveFeed({ enabled: false }, 'https://example.test/releases'))
      .toEqual({ url: 'https://example.test/releases', enabled: true, lockedByServer: true });
  });
});

describe('checkDue', () => {
  const feed = effectiveFeed({}, undefined);
  const at = Date.parse('2026-10-11T10:00:00.000Z');

  it('is due when never checked or 12 h have passed', () => {
    expect(checkDue({}, feed, at)).toBe(true);
    expect(checkDue(checked([]), feed, at + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(checkDue(checked([]), feed, at + UPDATE_CHECK_INTERVAL_MS)).toBe(true);
  });

  it('is never due when checks are off', () => {
    expect(checkDue({ enabled: false }, effectiveFeed({ enabled: false }, undefined), at)).toBe(false);
  });

  it('starts over when the feed changed', () => {
    expect(checkDue(checked([]), effectiveFeed({}, 'https://example.test/releases'), at)).toBe(true);
  });
});

describe('buildStatus', () => {
  it('lists newer releases, newest first, and says an update is available', () => {
    const s = buildStatus(checked([release('0.5.0'), release('0.4.0'), release('0.3.0'), release('0.2.0')]), env);
    expect(s).toMatchObject({
      version: '0.3.0', development: false, install: 'installer', enabled: true, lockedByServer: false,
      lastCheckedAt: '2026-10-11T10:00:00.000Z', error: null, skippedVersion: null, updateAvailable: true,
    });
    expect(s.latest?.version).toBe('0.5.0');
    expect(s.newer.map((r) => r.version)).toEqual(['0.5.0', '0.4.0']);
  });

  it('is up to date on the newest release', () => {
    const s = buildStatus(checked([release('0.3.0'), release('0.2.0')]), env);
    expect(s.newer).toEqual([]);
    expect(s.updateAvailable).toBe(false);
    expect(s.latest?.version).toBe('0.3.0');
  });

  it('never counts a prerelease as newer or latest', () => {
    const s = buildStatus(checked([release('0.4.0-rc.1', { prerelease: true }), release('0.3.0')]), env);
    expect(s.newer).toEqual([]);
    expect(s.latest?.version).toBe('0.3.0');
    expect(s.updateAvailable).toBe(false);
  });

  it('is quiet about a skipped version until something newer appears', () => {
    const skipped = buildStatus(checked([release('0.4.0'), release('0.3.0')], { skippedVersion: '0.4.0' }), env);
    expect(skipped.newer.map((r) => r.version)).toEqual(['0.4.0']);
    expect(skipped.skippedVersion).toBe('0.4.0');
    expect(skipped.updateAvailable).toBe(false);
    const past = buildStatus(checked([release('0.4.1'), release('0.4.0')], { skippedVersion: '0.4.0' }), env);
    expect(past.updateAvailable).toBe(true);
  });

  it('never offers an update to a development build', () => {
    const s = buildStatus(checked([release('0.4.0')]), { ...env, version: undefined });
    expect(s).toMatchObject({ version: 'dev', development: true, updateAvailable: false, newer: [] });
    expect(s.latest?.version).toBe('0.4.0');
  });

  it('shows no releases or error while checks are off', () => {
    const s = buildStatus(checked([release('0.4.0')], { enabled: false }), env);
    expect(s).toMatchObject({ enabled: false, latest: null, newer: [], error: null, lastCheckedAt: null, updateAvailable: false });
  });

  it('keeps the error of the last check', () => {
    const updates = checked([release('0.4.0')]);
    updates.lastCheck!.error = 'the feed answered 403';
    const s = buildStatus(updates, env);
    expect(s.error).toBe('the feed answered 403');
    expect(s.updateAvailable).toBe(true);
  });
});
