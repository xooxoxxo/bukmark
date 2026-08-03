import { basename, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { normalizeUrl, sha256Hex } from '@bukmark/shared';
import { parseOneTab } from './parsers/onetab.js';
import { classifyJunk, nonHttpRule, parseAllowlist } from './rules.js';
import { loadStore, mergeCapture, saveStore } from './store.js';
import type { Paths, Source } from '@bukmark/shared';

export interface IngestReport {
  file: string;
  fileSha256: string;
  alreadyIngested: boolean;
  captures: number;
  added: number;
  bumped: number;
  junked: number;
  malformed: number;
  malformedSamples: string[];
}

export function readFileWithFallback(filePath: string): string {
  const buf = readFileSync(filePath);
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

export function ingestFile(
  paths: Paths,
  filePath: string,
  source: Source,
  opts: { force?: boolean; now?: string } = {},
): IngestReport {
  const now = opts.now ?? new Date().toISOString();
  const raw = readFileSync(filePath);
  const fileSha256 = sha256Hex(raw.toString('binary'));
  const storeFile = join(paths.dataDir, 'store.json');
  const store = loadStore(storeFile);

  const report: IngestReport = {
    file: filePath, fileSha256, alreadyIngested: false,
    captures: 0, added: 0, bumped: 0, junked: 0, malformed: 0, malformedSamples: [],
  };

  if (store.ingestedFiles[fileSha256] && !opts.force) {
    report.alreadyIngested = true;
    return report;
  }

  const allowFile = join(paths.dataDir, 'allow.txt');
  const allowlist = existsSync(allowFile)
    ? parseAllowlist(readFileSync(allowFile, 'utf8'))
    : [];

  const content = readFileWithFallback(filePath);
  const captures = parseOneTab(content);
  report.captures = captures.length;

  for (const cap of captures) {
    const n = normalizeUrl(cap.url);
    if (!n.ok && n.reason === 'unparseable') {
      report.malformed += 1;
      if (report.malformedSamples.length < 10) report.malformedSamples.push(cap.url);
      continue;
    }
    const urlHash = n.ok ? n.urlHash : sha256Hex(cap.url.trim());
    const url = n.ok ? n.url : cap.url.trim();
    const { added } = mergeCapture(
      store,
      { urlHash, url, title: cap.title, groupHint: cap.groupHint },
      source,
      now,
    );
    added ? (report.added += 1) : (report.bumped += 1);

    const rec = store.links[urlHash]!;
    const verdict = n.ok
      ? classifyJunk(n.url, allowlist)
      : { junk: true as const, rule: nonHttpRule(cap.url) };
    if (verdict.junk) {
      rec.junk = { rule: verdict.rule };
      report.junked += 1;
    } else {
      delete rec.junk;
    }
  }

  store.ingestedFiles[fileSha256] = {
    filename: basename(filePath),
    ingestedAt: now,
    captureCount: captures.length,
  };
  saveStore(storeFile, store);
  return report;
}
