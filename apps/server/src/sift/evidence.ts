import type { SiftBookmark } from './model.js';
import { technicalTextCandidate } from './technical.js';
import { discussionSource, forumReferenceHeld } from './discussion.js';

export const SIFT_PAGE_TEXT_LIMIT = 4096;
const ITCH_RESERVED = new Set(['www', 'api', 'static', 'assets', 'cdn']);

/** Project pages only: profiles, platform discovery and nested devlogs are different sources. */
export function itchProject(input: string): boolean {
  const url = URL.parse(input);
  if (url?.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = /^([a-z0-9][a-z0-9-]*)\.itch\.io$/.exec(url.hostname);
  return Boolean(host && !ITCH_RESERVED.has(host[1]!) && /^\/[a-z0-9][a-z0-9-]*\/?$/.test(url.pathname));
}

export function usesPageText(input: string, title = ''): boolean {
  if (discussionSource({url:input,title}) || forumReferenceHeld({url:input,title})) return false;
  const url = URL.parse(input);
  return Boolean(url?.protocol === 'https:' && !url.username && !url.password && !url.port
    && (url.pathname === '/' || itchProject(input) || technicalTextCandidate(input, title)));
}

export function boundedPageText(value: unknown): string {
  return typeof value === 'string' ? value.replaceAll('\0', '').replace(/\s+/g, ' ').trim().slice(0, SIFT_PAGE_TEXT_LIMIT) : '';
}

interface CachedSource extends Pick<SiftBookmark, 'url' | 'title' | 'status'> {
  contentText?: unknown;
  httpStatus?: number | null;
  checkError?: string | null;
}

/** Reads existing local check evidence only. No network or provider port exists. */
export function localSiftInput(source: CachedSource): SiftBookmark {
  const input: SiftBookmark = { url: source.url, title: source.title, status: source.status };
  const text = source.httpStatus === 200 && !source.checkError && usesPageText(source.url, source.title)
    ? boundedPageText(source.contentText) : '';
  return text ? { ...input, pageText: text } : input;
}
