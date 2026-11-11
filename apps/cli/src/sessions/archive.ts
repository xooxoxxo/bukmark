import { linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function writeSessionArchive(outPath: string, records: Iterable<object>): void {
  const contents = Array.from(records, record => JSON.stringify(record)).join('\n') + '\n';
  const output = resolve(outPath);
  const stagingDir = mkdtempSync(join(dirname(output), '.bukmark-sessions-'));
  try {
    const staged = join(stagingDir, 'archive.jsonl');
    writeFileSync(staged, contents, { mode: 0o600, flag: 'wx' });
    // Publish only a complete file and preserve any archive already at output.
    linkSync(staged, output);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
