import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../cli.js';
import { captureSafari } from './safari.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'bukmark-safari-test-'));
  directories.push(directory);
  const dbPath = join(directory, 'SafariTabs.db');
  const outPath = join(directory, 'sessions.jsonl');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE bookmarks (
      id INTEGER PRIMARY KEY, parent INTEGER, type INTEGER, subtype INTEGER,
      title TEXT, url TEXT, order_index INTEGER, num_children INTEGER DEFAULT 0,
      hidden INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0
    );
    INSERT INTO bookmarks (id, parent, type, subtype, title, url, order_index, num_children) VALUES
      (1, 0, 1, 2, 'Research', '', 0, 1),
      (10, 0, 1, 0, 'Saved batch', '', 2, 2),
      (20, 1, 1, 0, 'Saved batch', '', 0, 1),
      (11, 10, 0, 0, 'Second', 'https://example.test/path#saved', 2, 0),
      (12, 10, 0, 0, 'First', 'https://example.test/path#saved', 1, 0),
      (21, 20, 0, 0, 'Other profile', 'https://example.test/other', 0, 0);
  `);
  return { db, dbPath, outPath };
}

function records(path: string) {
  return readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
}

describe('Safari session capture', () => {
  it('keeps same-named groups apart and keeps repeated tabs in their saved order', async () => {
    const { db, dbPath, outPath } = fixture();
    db.close();
    expect(await runCli(['sessions', 'capture', 'safari', '--db', dbPath, '--out', outPath])).toBe(0);

    const [header, first, firstTab, secondTab, second, otherTab] = records(outPath);
    expect(header).toMatchObject({ type: 'archive', format: 'bukmark-sessions', version: 1, source: 'safari-tab-groups' });
    expect(first).toMatchObject({ type: 'snapshot', name: 'Saved batch', profile: { id: 0, name: null }, tabCount: 2 });
    expect(second).toMatchObject({ type: 'snapshot', name: 'Saved batch', profile: { id: 1, name: 'Research' }, tabCount: 1 });
    expect(second.id).not.toBe(first.id);
    expect([firstTab, secondTab, otherTab]).toEqual([
      { type: 'tab', snapshotId: first.id, id: expect.any(String), title: 'First', url: 'https://example.test/path#saved', position: 1 },
      { type: 'tab', snapshotId: first.id, id: expect.any(String), title: 'Second', url: 'https://example.test/path#saved', position: 2 },
      { type: 'tab', snapshotId: second.id, id: expect.any(String), title: 'Other profile', url: 'https://example.test/other', position: 0 },
    ]);
    expect(firstTab.id).not.toBe(secondTab.id);
    expect(statSync(outPath).mode & 0o777).toBe(0o600);
  });

  it('keeps URL-less tabs and accounts for internal and excluded children separately', () => {
    const { db, dbPath, outPath } = fixture();
    db.exec(`
      UPDATE bookmarks SET num_children = 5 WHERE id = 10;
      INSERT INTO bookmarks VALUES
        (13, 10, 1, 1, 'Internal container', '', 0, 0, 0, 0),
        (14, 10, 0, 0, 'New tab', '', 3, 0, 0, 0),
        (15, 10, 0, 0, 'Hidden', 'https://example.test/hidden', 4, 0, 1, 0);
      INSERT INTO bookmarks VALUES (30, 0, 1, 0, 'Deleted group', '', 5, 0, 0, 1);
    `);
    db.close();

    expect(captureSafari(dbPath, outPath)).toEqual({ groups: 2, tabs: 4, missingUrls: 1, partialGroups: 0 });
    const [, group, , , blank] = records(outPath);
    expect(group).toMatchObject({ storedChildren: 5, counts: { children: 5, excluded: 1, internal: 1, unknown: 0, missingUrls: 1 } });
    expect(blank).toMatchObject({ type: 'tab', title: 'New tab', url: null, position: 3 });
  });

  it('includes committed tabs still in the WAL', () => {
    const { db, dbPath, outPath } = fixture();
    try {
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA wal_autocheckpoint = 0;
        BEGIN;
        INSERT INTO bookmarks VALUES (22, 20, 0, 0, 'New', 'https://example.test/wal', 1, 0, 0, 0);
        UPDATE bookmarks SET num_children = 2 WHERE id = 20;
        COMMIT;
      `);
      expect(captureSafari(dbPath, outPath)).toEqual({ groups: 2, tabs: 4, missingUrls: 0, partialGroups: 0 });
      expect(records(outPath).at(-1)).toMatchObject({ url: 'https://example.test/wal', position: 1 });
    } finally {
      db.close();
    }
  });

  it('rejects an unsupported database before publishing an archive', () => {
    const { db, dbPath, outPath } = fixture();
    db.exec('DROP TABLE bookmarks');
    db.close();

    expect(() => captureSafari(dbPath, outPath)).toThrow();
    expect(existsSync(outPath)).toBe(false);
  });

  it('leaves a previously exported archive intact', () => {
    const { db, dbPath, outPath } = fixture();
    db.close();
    writeFileSync(outPath, 'existing archive');

    expect(() => captureSafari(dbPath, outPath)).toThrow(expect.objectContaining({ code: 'EEXIST' }));
    expect(readFileSync(outPath, 'utf8')).toBe('existing archive');
  });
});
