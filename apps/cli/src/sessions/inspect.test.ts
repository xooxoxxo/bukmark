import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runCli } from '../cli.js';
import { inspectSessions } from './inspect.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function archive() {
  const dir = mkdtempSync(join(tmpdir(), 'bukmark-inspect-'));
  directories.push(dir);
  const path = join(dir, 'archive.jsonl');
  writeFileSync(path, [
    { type: 'archive', format: 'bukmark-sessions', version: 1 },
    { type: 'snapshot', id: 's1', name: 'Window', tabCount: 4, groups: [{ id: 'g', name: 'Research' }] },
    { type: 'tab', id: 'tab1', snapshotId: 's1', groupId: 'g', position: 0, url: 'https://example.test/a#part' },
    { type: 'tab', id: 'tab2', snapshotId: 's1', position: 1, url: 'https://user:pw@example.test/' },
    { type: 'tab', id: 'tab3', snapshotId: 's1', position: 2, url: 'chrome://settings/' },
    { type: 'tab', id: 'tab4', snapshotId: 's1', position: 3, url: null },
    { type: 'snapshot', id: 's2', name: 'Batch', tabCount: 1 },
    { type: 'tab', id: 'tab1', snapshotId: 's2', position: 0, url: 'http://m.example.test/a/' },
  ].map(row => JSON.stringify(row)).join('\n'));
  return path;
}

it('counts repeated bookmarks across snapshots without treating tab IDs as global', () => {
  expect(inspectSessions([archive()], [])).toMatchObject({ occurrences: 5, unique: 1,
    items: [{ snapshotId: 's1', occurrenceId: 'tab1' }, { snapshotId: 's2', occurrenceId: 'tab1' }],
    omitted: { missingUrl: 1, 'non-http': 1, credentials: 1 },
  });
});

it('sends only the selected group to the explicit destination in preview mode', async () => {
  const fetch = vi.fn(async (_url: URL, _init: RequestInit) => Response.json({ createdLinks: 0, recorded: 0,
    alreadyRecorded: 0, alreadyLinked: 0, existingProcessingEnabled: 0, skippedDeleted: 0, invalid: 0 }));
  vi.stubGlobal('fetch', fetch);
  vi.stubEnv('BUKMARK_TOKEN', 'test-token');
  expect(await runCli(['sessions', 'import', archive(), '--select', '1.1', '--destination', 'https://bukmark.example.test', '--preview'])).toBe(0);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(new URL('https://bukmark.example.test/api/links/session-import'), expect.objectContaining({
    redirect: 'error', body: JSON.stringify({ preview: true, items: [{ snapshotId: 's1', occurrenceId: 'tab1',
      url: 'https://example.test/a#part', snapshotName: 'Window', groupName: 'Research', position: 0 }] }),
  }));
});

it('refuses to send a selection without an explicit apply or preview', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  expect(await runCli(['sessions', 'import', archive(), '--all', '--destination', 'https://bukmark.example.test'])).toBe(1);
  expect(fetch).not.toHaveBeenCalled();
});
