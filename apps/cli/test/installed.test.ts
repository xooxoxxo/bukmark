import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const cli = join(root, 'packaging/bin/bukmark');
let folders: string[] = [];
beforeAll(() => execFileSync(process.execPath, ['apps/cli/build.mjs'], { cwd: root }));
afterEach(() => { for (const folder of folders) rmSync(folder, { recursive: true, force: true }); folders = []; });

function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'bukmark-installed-sessions-'));
  folders.push(folder);
  const bin = join(folder, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\ncp "$TEST_HELPER" "$3"\n', { mode: 0o700 });
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\necho unexpected-docker >&2\nexit 99\n', { mode: 0o700 });
  const env = { ...process.env, BUKMARK_HOME: join(folder, 'home'), PATH: `${bin}:${process.env.PATH}`,
    TEST_HELPER: join(root, 'packaging/dist/bukmark-sessions.mjs') };
  return { folder, env, run: (...args: string[]) => spawnSync('sh', [cli, 'sessions', ...args], { cwd: folder, env, encoding: 'utf8' }) };
}

describe('installed local session commands', () => {
  it('checks and caches the versioned helper without using Docker', () => {
    const f = fixture();
    const first = f.run('--help');
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain('sessions close android');
    const cached = join(f.env.BUKMARK_HOME, 'tools/sessions-0.5.0.mjs');
    expect(readFileSync(cached)).toEqual(readFileSync(f.env.TEST_HELPER));
    f.env.TEST_HELPER = '/does-not-exist';
    expect(f.run('--help').status).toBe(0);
  });

  it('never executes a downloaded helper with the wrong checksum', () => {
    const f = fixture();
    const marker = join(f.folder, 'executed');
    const tampered = join(f.folder, 'wrong.mjs');
    writeFileSync(tampered, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    f.env.TEST_HELPER = tampered;
    const result = f.run('--help');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('checksum did not match');
    expect(() => readFileSync(marker)).toThrow();
  });

  it('captures and inspects a saved local probe through the installed command', () => {
    const f = fixture();
    const probe = join(f.folder, 'probe.json');
    const archive = join(f.folder, 'tabs.jsonl');
    writeFileSync(probe, JSON.stringify({ version: 1, browser: 'Chrome/157.0.8103.48',
      pages: [{ id: '17', title: 'Saved', url: 'https://example.test/saved#original' }] }));
    const result = f.run('capture', 'android', '--probe', probe, '--out', archive, '--confirm-no-incognito');
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(archive, 'utf8')).toContain('https://example.test/saved#original');
    const inspection = f.run('inspect', archive);
    expect(inspection.status, inspection.stderr).toBe(0);
    expect(inspection.stdout).toContain('1 selected tab occurrences');
    expect(inspection.stdout).not.toContain('https://example.test');
  });
});
