import type { RawCapture } from '@bookmarkt/shared';

export function parseOneTab(content: string): RawCapture[] {
  const captures: RawCapture[] = [];
  let hint: string | undefined;
  const lines = content.replace(/^﻿/, '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') {
      hint = undefined;
      continue;
    }
    if (!line.includes('://')) {
      hint = line.slice(0, 80);
      continue;
    }
    const sep = line.indexOf(' | ');
    const url = sep === -1 ? line : line.slice(0, sep);
    const title = sep === -1 ? '' : line.slice(sep + 3).trim();
    captures.push(hint ? { url, title, groupHint: hint } : { url, title });
  }
  return captures;
}
