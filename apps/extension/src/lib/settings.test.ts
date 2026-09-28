import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../test/chrome';
import { DEFAULT_BASE_URL, changesSettings, loadSettings, normalizeBaseUrl, saveSettings } from './settings';

afterEach(() => { vi.unstubAllGlobals(); });

describe('normalizeBaseUrl', () => {
  it('strips a trailing slash so path joins do not double up', () => {
    expect(normalizeBaseUrl('http://host:8085/')).toBe('http://host:8085');
  });

  it('leaves a clean url alone', () => {
    expect(normalizeBaseUrl('http://host:8085')).toBe('http://host:8085');
  });

  it('trims surrounding whitespace from a pasted value', () => {
    expect(normalizeBaseUrl('  http://host:8085  ')).toBe('http://host:8085');
  });

  it('falls back to the default when given an empty string', () => {
    expect(normalizeBaseUrl('')).toBe(DEFAULT_BASE_URL);
  });

  it('defaults to localhost so a fresh clone works with no configuration', () => {
    expect(DEFAULT_BASE_URL).toBe('http://localhost:3000');
  });

  it('never ships a private or tailnet default', () => {
    // A published default pointing at someone's LAN is both a leak and broken
    // for everyone else. Self-hosters set their own URL in the options page.
    expect(DEFAULT_BASE_URL).not.toMatch(/\b(?:10|127|192\.168|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./);
    expect(DEFAULT_BASE_URL).not.toContain('.home');
  });
});

describe('loadSettings and saveSettings', () => {
  it('keep the server in storage.sync, so it follows the person between browsers', async () => {
    const chrome = fakeChrome();
    vi.stubGlobal('chrome', chrome);
    await expect(loadSettings()).resolves.toEqual({ baseUrl: DEFAULT_BASE_URL });
    await saveSettings({ baseUrl: 'http://nas.lan:3000/' });
    expect(chrome.storage.sync.data.baseUrl).toBe('http://nas.lan:3000');
    expect(chrome.storage.local.data.baseUrl).toBeUndefined();
    await expect(loadSettings()).resolves.toEqual({ baseUrl: 'http://nas.lan:3000' });
  });

  it('use storage.local where there is no sync area (Opera)', async () => {
    const chrome = fakeChrome({ without: ['sync'] });
    vi.stubGlobal('chrome', chrome);
    expect('sync' in chrome.storage).toBe(false);
    await expect(loadSettings()).resolves.toEqual({ baseUrl: DEFAULT_BASE_URL });
    await saveSettings({ baseUrl: 'http://nas.lan:3000' });
    expect(chrome.storage.local.data.baseUrl).toBe('http://nas.lan:3000');
    await expect(loadSettings()).resolves.toEqual({ baseUrl: 'http://nas.lan:3000' });
  });

  it('use storage.local when the sync area fails', async () => {
    const chrome = fakeChrome({ local: { baseUrl: 'http://kept.lan:3000' } });
    chrome.storage.sync.get.mockRejectedValue(new Error('sync is off'));
    chrome.storage.sync.set.mockRejectedValue(new Error('sync is off'));
    vi.stubGlobal('chrome', chrome);
    await expect(loadSettings()).resolves.toEqual({ baseUrl: 'http://kept.lan:3000' });
    await saveSettings({ baseUrl: 'http://nas.lan:3000' });
    expect(chrome.storage.local.data.baseUrl).toBe('http://nas.lan:3000');
  });
});

describe('changesSettings', () => {
  it('spots the server changing in whichever area holds it', () => {
    expect(changesSettings({ baseUrl: {} }, 'sync')).toBe(true);
    expect(changesSettings({ baseUrl: {} }, 'local')).toBe(true);
    expect(changesSettings({ auth: {} }, 'local')).toBe(false);
    expect(changesSettings({ baseUrl: {} }, 'session')).toBe(false);
  });
});
