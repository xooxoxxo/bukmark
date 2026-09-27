import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const root = join(import.meta.dirname, '../../..');
export const read = (p: string): string => readFileSync(join(root, p), 'utf8');

const DOCS_DIR = 'apps/site/src/content/docs/docs';

/** Every documentation page, as repo-relative path and markdown. */
export function docPages(): { file: string; body: string }[] {
  return readdirSync(join(root, DOCS_DIR))
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ file: `${DOCS_DIR}/${f}`, body: read(`${DOCS_DIR}/${f}`) }));
}

/** Repo-relative paths of the non-test files under `dir` with one of `extensions`. */
export function sourceFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => extensions.some((e) => f.endsWith(e)) && !/\.test\.tsx?$/.test(f))
    .map((f) => `${dir}/${f}`);
}

export interface Section {
  level: number;
  title: string;
  body: string;
}

/**
 * Every heading with the markdown under it, up to the next heading of the same
 * or a higher level. Lines inside fenced code are not headings: shell comments
 * start with `#` too.
 */
export function sections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const heads: { line: number; level: number; title: string }[] = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = fenced ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) heads.push({ line: i, level: m[1]!.length, title: m[2]!.trim() });
  });
  return heads.map((h, k) => {
    const next = heads.slice(k + 1).find((n) => n.level <= h.level);
    return { level: h.level, title: h.title, body: lines.slice(h.line + 1, next?.line).join('\n') };
  });
}

export function section(markdown: string, title: string): string {
  const found = sections(markdown).filter((s) => s.title === title);
  if (found.length !== 1) throw new Error(`expected one "${title}" heading, found ${found.length}`);
  return found[0]!.body;
}
