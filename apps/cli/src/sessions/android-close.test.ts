import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@bukmark/shared';
import { closeVerifiedAndroid } from './android-close.js';
import { connectAndroidUsb } from './android-transport.js';
import { verifySessionItems } from './selection-command.js';

vi.mock('./selection-command.js', () => ({ verifySessionItems: vi.fn() }));
vi.mock('./android-transport.js', async original => ({
  ...await original<typeof import('./android-transport.js')>(), connectAndroidUsb: vi.fn(),
}));

describe('verified Android tab closure', () => {
  let folder: string;
  let archive: string;
  let log: string;
  let targets: { id: string; type: string; url: string }[];
  let phone: ReturnType<typeof connectAndroidUsb>;
  const fingerprint = 'a'.repeat(64);
  const url = 'https://example.test/saved';

  beforeEach(() => {
    vi.stubEnv('BUKMARK_TOKEN', 'fixture-token');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    folder = mkdtempSync(join(tmpdir(), 'bukmark-close-test-'));
    archive = join(folder, 'tabs.jsonl');
    log = join(folder, 'closed.jsonl');
    writeFileSync(archive, [
      { type: 'archive', format: 'bukmark-sessions', version: 1, source: 'android-chrome-usb', deviceFingerprint: fingerprint },
      { type: 'snapshot', id: 'phone', name: 'Phone', tabCount: 2, partial: true },
      { type: 'tab', snapshotId: 'phone', id: '17', url, title: 'Saved', position: null },
      { type: 'tab', snapshotId: 'phone', id: '18', url: 'https://example.test/active', position: null },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    targets = [
      { id: '17', type: 'page', url },
      { id: '18', type: 'tab', url: 'https://example.test/active' },
      { id: '19', type: 'page', url: 'https://example.test/unverified' },
    ];
    phone = {
      fingerprint, assertForeground: vi.fn(), assertSwitcher: vi.fn(), disconnect: vi.fn(),
      json: vi.fn(async path => path === '/json/version' ? { 'Android-Package': 'com.android.chrome', Browser: 'Chrome/157.0.8103.48' } : targets.map(row => ({ ...row }))),
      close: vi.fn(async id => { targets = targets.filter(row => row.id !== id); }),
    };
    vi.mocked(connectAndroidUsb).mockReturnValue(phone);
    vi.mocked(verifySessionItems).mockResolvedValue([
      { snapshotId: 'phone', occurrenceId: '17', urlHash: sha256Hex(url) },
      { snapshotId: 'phone', occurrenceId: '18', urlHash: sha256Hex('https://example.test/active') },
    ]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(folder, { recursive: true, force: true });
  });

  const args = () => [archive, '--destination', 'https://bukmark.example', '--apply', '--log', log, '--confirm-no-incognito'];

  it('closes only exact saved background tabs and records confirmed removals', async () => {
    expect(await closeVerifiedAndroid(args())).toBe(0);
    expect(phone.close).toHaveBeenCalledExactlyOnceWith('17');
    expect(targets.map(row => row.id)).toEqual(['18', '19']);
    const events = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(events.filter(row => row.event === 'closed').map(row => row.id)).toEqual(['17']);
    expect(readFileSync(log, 'utf8')).not.toContain(url);
    expect(phone.disconnect).toHaveBeenCalledOnce();
  });

  it('leaves changed URLs open even when their old IDs have receipts', async () => {
    targets[0]!.url = 'https://example.test/changed';
    await closeVerifiedAndroid(args());
    expect(phone.close).not.toHaveBeenCalled();
  });

  it('refuses closure on a different handset and removes the forward', async () => {
    phone.fingerprint = 'b'.repeat(64);
    await expect(closeVerifiedAndroid(args())).rejects.toThrow('connected phone differs');
    expect(phone.close).not.toHaveBeenCalled();
    expect(phone.disconnect).toHaveBeenCalledOnce();
  });

  it('stops before mutation when targets change during the operation', async () => {
    let lists = 0;
    vi.mocked(phone.json).mockImplementation(async path => {
      if (path === '/json/version') return { 'Android-Package': 'com.android.chrome', Browser: 'Chrome/157.0.8103.48' };
      if (++lists > 1) targets[0]!.url = 'https://example.test/changed';
      return targets.map(row => ({ ...row }));
    });
    await expect(closeVerifiedAndroid(args())).rejects.toThrow('changed outside');
    expect(phone.close).not.toHaveBeenCalled();
  });

  it('retains an uncertain close request in the log and stops', async () => {
    vi.mocked(phone.close).mockRejectedValue(new Error('Connection lost'));
    await expect(closeVerifiedAndroid(args())).rejects.toThrow('Connection lost');
    const events = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(row => row.event)).toEqual(['start', 'close-requested', 'stopped']);
    expect(phone.disconnect).toHaveBeenCalledOnce();
  });

  it('does not report completion when an unverified target disappears after the last close', async () => {
    let lists = 0;
    vi.mocked(phone.json).mockImplementation(async path => {
      if (path === '/json/version') return { 'Android-Package': 'com.android.chrome', Browser: 'Chrome/157.0.8103.48' };
      if (++lists === 4) targets = targets.filter(row => row.id !== '19');
      return targets.map(row => ({ ...row }));
    });
    await expect(closeVerifiedAndroid(args())).rejects.toThrow('during the final check');
    expect(phone.close).toHaveBeenCalledExactlyOnceWith('17');
    const events = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(events.some(row => row.event === 'complete')).toBe(false);
    expect(events.at(-1).event).toBe('stopped');
  });

  it('refuses to close tabs on an unvalidated Chrome build', async () => {
    vi.mocked(phone.json).mockResolvedValue({ 'Android-Package': 'com.android.chrome', Browser: 'Chrome/158.0.0.0' });
    await expect(closeVerifiedAndroid(args())).rejects.toThrow('not been validated');
    expect(phone.close).not.toHaveBeenCalled();
    expect(phone.disconnect).toHaveBeenCalledOnce();
  });

  it('preserves verified background targets that share a loaded target URL', async () => {
    targets.push({ id: '20', type: 'tab', url });
    await closeVerifiedAndroid(args());
    expect(phone.close).not.toHaveBeenCalled();
  });
});
