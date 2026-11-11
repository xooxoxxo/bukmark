import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../cli.js';
import { captureChrome } from './chrome.js';
import { ChromeSessionError, readChromeSession } from './chrome-session.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function ints(...values: number[]): Buffer {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeInt32LE(value, index * 4));
  return bytes;
}

function string(value: string, encoding: 'utf8' | 'utf16le' = 'utf8'): Buffer {
  const bytes = Buffer.from(value, encoding);
  const padding = Buffer.alloc((4 - bytes.length % 4) % 4);
  return Buffer.concat([ints(encoding === 'utf16le' ? value.length : bytes.length), bytes, padding]);
}

function record(id: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(3);
  header.writeUInt16LE(payload.length + 1);
  header[2] = id;
  return Buffer.concat([header, payload]);
}

function pickle(id: number, ...fields: Buffer[]): Buffer {
  const payload = Buffer.concat(fields);
  return record(id, Buffer.concat([ints(payload.length), payload]));
}

function navigation(tabId: number, index: number, url: string, title = 'Page'): Buffer {
  return pickle(6, ints(tabId, index), string(url), string(title, 'utf16le'), string('encoded state'), ints(0));
}

function tab(window: number, id: number, position: number, url = `https://example.test/${id}`): Buffer[] {
  return [record(0, ints(window, id)), record(2, ints(id, position)), navigation(id, 0, url), record(7, ints(id, 0))];
}

function session(...records: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from('SNSS'), ints(3), ...records]);
}

function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'bukmark-chrome-test-'));
  directories.push(dir);
  return { dir, outPath: join(dir, 'sessions.jsonl') };
}

function archive(outPath: string) {
  return readFileSync(outPath, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
}

describe('Chrome session capture', () => {
  it('replays saved order, group metadata, selection, pruning and closes', () => {
    const groupToken = Buffer.from('01000000000000000200000000000000', 'hex');
    const membership = (tabId: number, grouped: boolean) => record(25, Buffer.concat([
      ints(tabId, 0), groupToken, ints(Number(grouped), 0),
    ]));
    const metadata = (name: string, collapsed: boolean) => pickle(27, groupToken, string(name, 'utf16le'), ints(4, Number(collapsed), 0));
    const data = session(
      record(9, ints(1, 0)), record(9, ints(2, 0)),
      ...tab(1, 12, 0), ...tab(1, 11, 1), ...tab(1, 13, 2), ...tab(2, 21, 0),
      membership(11, true), membership(12, true), metadata('Old name', false),
      navigation(11, 1, 'https://example.test/chosen', 'Café'),
      navigation(11, 2, 'https://example.test/forward'), record(7, ints(11, 1)),
      record(255),
      record(2, ints(11, 0)), record(2, ints(12, 1)),
      record(24, ints(11, 0, 1)), membership(12, false), metadata('Saved 🧭', true),
      record(12, ints(11, 1)), record(16, ints(13, 0, 0, 0)), record(17, ints(2, 0, 0, 0)),
    );
    expect(readChromeSession(data)).toEqual({
      partialReason: null,
      windows: [{ id: 1, name: null, type: 0,
        groups: [{ id: '00000000000000010000000000000002', name: 'Saved 🧭', color: 4, collapsed: true }],
        tabs: [
          { id: 11, position: 0, groupId: '00000000000000010000000000000002', pinned: true, navigation: 'selected', title: 'Café', url: 'https://example.test/chosen' },
          { id: 12, position: 1, groupId: null, pinned: false, navigation: 'selected', title: 'Page', url: 'https://example.test/12' },
        ],
      }],
    });
  });

  it('keeps windows from different files separate and ignores Tabs files', async () => {
    const { dir, outPath } = directory();
    const data = session(record(9, ints(1, 0)), ...tab(1, 11, 0), record(255));
    writeFileSync(join(dir, 'Session_11644473600000000'), data);
    writeFileSync(join(dir, 'Session_11644473601000000'), data);
    writeFileSync(join(dir, 'Tabs_11644473602000000'), data);
    expect(await runCli(['sessions', 'capture', 'chrome', '--sessions', dir, '--out', outPath, '--profile', 'Default'])).toBe(0);

    const [header, first, firstTab, second, secondTab] = archive(outPath);
    expect(header).toMatchObject({ type: 'archive', format: 'bukmark-sessions', version: 1, source: 'chrome-sessions', sessions: [
      { file: 'Session_11644473600000000', fileCreatedAt: '1970-01-01T00:00:00.000Z', windows: 1, partialReason: null },
      { file: 'Session_11644473601000000', fileCreatedAt: '1970-01-01T00:00:01.000Z', windows: 1, partialReason: null },
    ] });
    expect(first).toMatchObject({ type: 'snapshot', sessionId: header.sessions[0].id, profile: { name: 'Default' }, tabCount: 1 });
    expect(second).toMatchObject({ type: 'snapshot', sessionId: header.sessions[1].id, tabCount: 1 });
    expect(first.id).not.toBe(second.id);
    expect(firstTab).toMatchObject({ snapshotId: first.id, url: 'https://example.test/11', position: 0 });
    expect(secondTab).toMatchObject({ snapshotId: second.id, url: 'https://example.test/11', position: 0 });
    expect(statSync(outPath).mode & 0o777).toBe(0o600);
  });

  it('reports a recoverable partial file and a skipped encrypted file', () => {
    const { dir, outPath } = directory();
    writeFileSync(join(dir, 'Session_1'), session(record(9, ints(1, 0)), ...tab(1, 11, 0), record(255), Buffer.from([4, 0, 16])));
    writeFileSync(join(dir, 'Session_2'), Buffer.concat([Buffer.from('SNSS'), ints(5)]));
    expect(captureChrome(dir, outPath)).toMatchObject({ sessions: 1, tabs: 1, partialWindows: 1,
      partialFiles: [{ file: 'Session_1', reason: expect.any(String) }],
      skippedFiles: [{ file: 'Session_2', reason: expect.stringContaining('Encrypted') }],
    });
    expect(archive(outPath)[1]).toMatchObject({ partial: true, tabCount: 1 });
  });

  it('does not export a file that lacks a complete initial state', () => {
    const { dir, outPath } = directory();
    const data = session(record(9, ints(1, 0)), ...tab(1, 11, 0));
    writeFileSync(join(dir, 'Session_1'), data);
    expect(() => readChromeSession(data)).toThrow(ChromeSessionError);
    expect(() => captureChrome(dir, outPath)).toThrow();
    expect(existsSync(outPath)).toBe(false);
  });
});
