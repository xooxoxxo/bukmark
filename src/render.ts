import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Canon, LinkRecord, Store } from './types.js';

type Entry = LinkRecord & { urlHash: string };

function byRank(a: Entry, b: Entry): number {
  const rel = (b.triage?.relevance ?? 0) - (a.triage?.relevance ?? 0);
  if (rel !== 0) return rel;
  if (b.dupeCount !== a.dupeCount) return b.dupeCount - a.dupeCount;
  return a.title.localeCompare(b.title);
}

function linkLine(l: Entry): string {
  const t = l.triage!;
  const title = l.title === '' ? l.url : l.title;
  const dupe = l.dupeCount > 1 ? ` _(saved ${l.dupeCount}×)_` : '';
  return `- [${title}](${l.url}) — ${t.relevance}/5 — ${t.explanation}${dupe}`;
}

export function renderAll(store: Store, canon: Canon, outputDir: string): void {
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const all: Entry[] = Object.entries(store.links).map(([urlHash, l]) => ({ ...l, urlHash }));
  const junk = all.filter((l) => l.junk);
  const tossed = all.filter((l) => !l.junk && l.triage && !l.triage.keep);
  const kept = all.filter((l) => !l.junk && l.triage?.keep);
  const pending = all.filter((l) => !l.junk && !l.triage);

  const byCategory = new Map<string, Entry[]>();
  for (const l of kept) {
    const c = l.triage!.category;
    byCategory.set(c, [...(byCategory.get(c) ?? []), l]);
  }
  const weighted = [...byCategory.entries()]
    .map(([category, links]) => ({
      category,
      links: links.sort(byRank),
      weight: links.reduce((sum, l) => sum + (l.triage?.relevance ?? 0), 0),
    }))
    .sort((a, b) => b.weight - a.weight || a.category.localeCompare(b.category));

  const index: string[] = [
    '# bookmarkt index', '',
    `- Total links: ${all.length}`,
    `- Kept: ${kept.length}`,
    `- Tossed: ${tossed.length}`,
    `- Junk: ${junk.length}`,
    `- Pending triage: ${pending.length}`,
    `- Dupes collapsed: ${all.reduce((s, l) => s + l.dupeCount - 1, 0)}`,
    '',
  ];
  for (const { category, links, weight } of weighted) {
    index.push(`## ${category}`, '', `${links.length} links, weight ${weight} — [${category}.md](${category}.md)`, '');
    for (const l of links.slice(0, 5)) index.push(linkLine(l));
    index.push('');
    writeFileSync(
      join(outputDir, `${category}.md`),
      [`# ${category}`, '', ...links.map(linkLine), ''].join('\n'),
    );
  }
  writeFileSync(join(outputDir, 'INDEX.md'), index.join('\n'));

  const report: string[] = ['# Junk report', '', '## Rule-filtered', ''];
  const byRule = new Map<string, Entry[]>();
  for (const l of junk) {
    const r = l.junk!.rule;
    byRule.set(r, [...(byRule.get(r) ?? []), l]);
  }
  for (const [rule, links] of [...byRule.entries()].sort()) {
    report.push(`### ${rule}`, '');
    for (const l of links) report.push(`- ${l.url}`);
    report.push('');
  }
  report.push('## Tossed by triage', '');
  for (const l of tossed.sort(byRank)) {
    report.push(`- [${l.title === '' ? l.url : l.title}](${l.url}) — ${l.triage!.reason ?? ''}`);
  }
  report.push('');
  writeFileSync(join(outputDir, 'junk-report.md'), report.join('\n'));
}
