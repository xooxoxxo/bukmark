import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome, type FakeSeed } from '../test/chrome';
import { matchesEverywhere, validEverywhere } from '../test/matchPattern';
import {
  allowBookmarkImport,
  canImportBookmarks,
  ensureHostPermission,
  originPatternFor,
  pageHostAccess,
  popupHostAccess,
} from './permissions';

function arrange(seed: FakeSeed = {}) {
  const chrome = fakeChrome(seed);
  vi.stubGlobal('chrome', chrome);
  return chrome;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the match-pattern rules these tests hold patterns to', () => {
  it('agree with Firefox’s own test vectors (toolkit/components/extensions/test/xpcshell/test_MatchPattern.js)', () => {
    expect(matchesEverywhere('http://mozilla.org/', 'http://mozilla.org:8080')).toBe(true);
    expect(matchesEverywhere('*://mozilla.org/', 'http://mozilla.org:8080')).toBe(true);
    expect(matchesEverywhere('http://mozilla.org:8080/', 'http://mozilla.org:8080')).toBe(false);
  });

  it('refuse a port, as Safari does, but not an IPv6 address', () => {
    expect(validEverywhere('http://localhost:3000/*')).toBe(false);
    expect(validEverywhere('http://[::1]:3000/*')).toBe(false);
    expect(validEverywhere('http://[::1]/*')).toBe(true);
  });
});

describe('originPatternFor', () => {
  it('builds a match pattern for the host, without the port Firefox and Safari cannot take', () => {
    expect(originPatternFor('http://localhost:3000')).toBe('http://localhost/*');
    expect(originPatternFor('http://nas.lan:3000')).toBe('http://nas.lan/*');
  });

  it('drops a non-default port on a hostname', () => {
    expect(originPatternFor('http://bukmark.example.com:8085')).toBe('http://bukmark.example.com/*');
  });

  it('keeps an IPv6 address in its brackets', () => {
    expect(originPatternFor('http://[::1]:3000')).toBe('http://[::1]/*');
    expect(originPatternFor('http://[FD7A:115C:A1E0::1]:3000/')).toBe('http://[fd7a:115c:a1e0::1]/*');
  });

  it.each([
    'http://localhost:3000',
    'http://nas.lan:3000/',
    'https://bukmark.example.com:8443',
    'http://100.64.0.7:8080/bukmark',
    'http://[::1]:3000',
  ])('asks for a pattern every browser honours, and that covers %s itself', (server) => {
    const pattern = originPatternFor(server)!;
    expect(validEverywhere(pattern)).toBe(true);
    expect(matchesEverywhere(pattern, `${server.replace(/\/$/, '')}/api/auth/status`)).toBe(true);
  });

  it('handles https', () => {
    expect(originPatternFor('https://books.example.com')).toBe('https://books.example.com/*');
  });

  it('ignores a path, since match patterns are per-host', () => {
    expect(originPatternFor('http://localhost:3000/api/links')).toBe('http://localhost/*');
  });

  it('tolerates a trailing slash', () => {
    expect(originPatternFor('http://localhost:3000/')).toBe('http://localhost/*');
  });

  it('returns null for a non-http scheme', () => {
    expect(originPatternFor('ftp://localhost:3000')).toBeNull();
  });

  it('returns null for an unparseable url', () => {
    expect(originPatternFor('not a url')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(originPatternFor('')).toBeNull();
  });
});

describe('ensureHostPermission', () => {
  it('asks straight away, without checking first: Firefox refuses a request after any other await', async () => {
    const chrome = arrange();
    const asked = ensureHostPermission('http://nas.lan:3000');
    // Called synchronously, still inside the click.
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['http://nas.lan/*'] });
    await expect(asked).resolves.toBe(true);
    expect(chrome.permissions.contains).not.toHaveBeenCalled();
  });

  it('is false when the prompt is declined, or the browser refuses to ask', async () => {
    const chrome = arrange();
    chrome.permissions.request.mockResolvedValueOnce(false);
    await expect(ensureHostPermission('http://nas.lan:3000')).resolves.toBe(false);
    chrome.permissions.request.mockRejectedValueOnce(new Error('permissions.request may only be called from a user input handler'));
    await expect(ensureHostPermission('http://nas.lan:3000')).resolves.toBe(false);
  });

  it('asks nothing for an address that is not http(s)', async () => {
    const chrome = arrange();
    await expect(ensureHostPermission('nas.lan:3000')).resolves.toBe(false);
    expect(chrome.permissions.request).not.toHaveBeenCalled();
  });
});

describe('pageHostAccess', () => {
  it('turns the prompt’s answer into granted or declined', async () => {
    const chrome = arrange();
    await expect(pageHostAccess('http://nas.lan:3000')).resolves.toBe('granted');
    chrome.permissions.request.mockResolvedValueOnce(false);
    await expect(pageHostAccess('http://nas.lan:3000')).resolves.toBe('declined');
  });
});

describe('popupHostAccess', () => {
  it('asks from the popup in Chrome and other browsers', async () => {
    const chrome = arrange();
    const access = popupHostAccess('http://nas.lan:3000');
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['http://nas.lan/*'] });
    await expect(access).resolves.toBe('granted');
  });

  it('only checks in Firefox, which cannot show the prompt over its popup', async () => {
    const chrome = arrange({ browser: 'firefox' });
    await expect(popupHostAccess('http://nas.lan:3000')).resolves.toBe('granted');
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['http://nas.lan/*'] });
    expect(chrome.permissions.request).not.toHaveBeenCalled();
  });

  it('sends a new server to the options page in Firefox', async () => {
    const chrome = arrange({ browser: 'firefox' });
    chrome.permissions.contains.mockResolvedValue(false);
    await expect(popupHostAccess('http://nas.lan:3000')).resolves.toBe('ask-in-options');
    expect(chrome.permissions.request).not.toHaveBeenCalled();
  });
});

describe('allowBookmarkImport', () => {
  it('asks Chrome for the optional bookmarks permission, synchronously in the click', async () => {
    const chrome = arrange();
    const allowed = allowBookmarkImport();
    expect(chrome.permissions.request).toHaveBeenCalledWith({ permissions: ['bookmarks'] });
    await expect(allowed).resolves.toBe(true);
  });

  it('asks Firefox for bookmarks and its bookmarksInfo data collection in one prompt', async () => {
    const chrome = arrange({ browser: 'firefox' });
    const allowed = allowBookmarkImport();
    expect(chrome.permissions.request).toHaveBeenCalledWith({ permissions: ['bookmarks'], data_collection: ['bookmarksInfo'] });
    await expect(allowed).resolves.toBe(true);
  });

  it('is false when that is declined, or the request fails', async () => {
    const chrome = arrange();
    chrome.permissions.request.mockResolvedValueOnce(false);
    await expect(allowBookmarkImport()).resolves.toBe(false);
    chrome.permissions.request.mockRejectedValueOnce(new Error('not in a user gesture'));
    await expect(allowBookmarkImport()).resolves.toBe(false);
  });

  it('asks nothing in a build without bookmarks (Safari)', async () => {
    const chrome = arrange({ browser: 'safari', without: ['bookmarks'] });
    await expect(allowBookmarkImport()).resolves.toBe(true);
    expect(chrome.permissions.request).not.toHaveBeenCalled();
  });
});

describe('canImportBookmarks', () => {
  it('is true where the manifest lists bookmarks, at install or optional, and false in Safari', () => {
    arrange();
    expect(canImportBookmarks()).toBe(true);
    arrange({ browser: 'firefox' });
    expect(canImportBookmarks()).toBe(true);
    arrange({ browser: 'safari', without: ['bookmarks'] });
    expect(canImportBookmarks()).toBe(false);
  });
});
