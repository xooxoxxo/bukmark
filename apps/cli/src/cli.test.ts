import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from './cli.js';
import type { Paths } from '@bookmarkt/shared';
import type { BatchResultFile } from './triage.js';

const FIXTURE = new URL('../fixtures/sample-onetab.txt', import.meta.url).pathname;

function setup(): Paths {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  return { dataDir: join(dir, 'data'), workDir: join(dir, 'work'), outputDir: join(dir, 'out') };
}

describe('end-to-end', () => {
  it('ingest → prepare → fake triage → merge → render', async () => {
    const paths = setup();
    expect(await runCli(['ingest', FIXTURE], paths)).toBe(0);
    expect(await runCli(['prepare', '--batch-size', '3'], paths)).toBe(0);

    const batchNames = readdirSync(paths.workDir).filter((n) => /^batch-\d+\.json$/.test(n));
    expect(batchNames).toHaveLength(2); // 5 non-junk links, batch size 3

    for (const name of batchNames) {
      const batch = JSON.parse(readFileSync(join(paths.workDir, name), 'utf8'));
      const result: BatchResultFile = {
        batch: batch.batch,
        results: batch.links.map((l: { urlHash: string }) => ({
          urlHash: l.urlHash, category: 'dev tools', keep: true, relevance: 4, explanation: 'e2e',
        })),
      };
      writeFileSync(
        join(paths.workDir, `batch-${batch.batch}.result.json`),
        JSON.stringify(result),
      );
    }

    expect(await runCli(['merge-triage'], paths)).toBe(0);
    expect(readdirSync(paths.workDir)).toEqual([]); // consumed batches cleaned up
    const canon = JSON.parse(readFileSync(join(paths.dataDir, 'categories.json'), 'utf8'));
    expect(canon.categories).toEqual(['dev-tools']);

    expect(await runCli(['render'], paths)).toBe(0);
    const index = readFileSync(join(paths.outputDir, 'INDEX.md'), 'utf8');
    expect(index).toContain('## dev-tools');
    expect(index).toContain('Junk: 3');
    expect(existsSync(join(paths.outputDir, 'dev-tools.md'))).toBe(true);
  });

  it('invalid batch leaves files and returns nonzero', async () => {
    const paths = setup();
    await runCli(['ingest', FIXTURE], paths);
    await runCli(['prepare'], paths);
    writeFileSync(
      join(paths.workDir, 'batch-1.result.json'),
      JSON.stringify({ batch: 1, results: [{ urlHash: 'bogus', category: 'x', keep: true, relevance: 9, explanation: 'e' }] }),
    );
    expect(await runCli(['merge-triage'], paths)).toBe(1);
    expect(existsSync(join(paths.workDir, 'batch-1.result.json'))).toBe(true);
  });

  it('re-running full loop is a no-op', async () => {
    const paths = setup();
    await runCli(['ingest', FIXTURE], paths);
    const r = await runCli(['ingest', FIXTURE], paths);
    expect(r).toBe(0); // already-ingested is not an error
    expect(await runCli(['prepare'], paths)).toBe(0);
  });

  it('unknown command returns 2', async () => {
    expect(await runCli(['wat'], setup())).toBe(2);
  });
});
